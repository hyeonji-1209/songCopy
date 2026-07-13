#!/usr/bin/env python3
"""AI 채보 파이프라인 v2 — 상업 라이선스 안전 스택 (ml/.venv 전용).

  분리:   MVSEP_API_KEY 있으면 MVSep API(BS Roformer SW, sep_type 61 — 출력물 상업 이용 허용),
          없으면 로컬 BS-Roformer-SW (개발 전용 — 가중치 라이선스 불명, 상업 배포 불가)
  채보:   기타/신스 YourMT3+ (가중치 Apache-2.0), 피아노 Transkun(MIT),
          보컬/베이스 pyin F0+온셋 전용 경로(librosa, ISC — 벤치 F1 0.97/0.99 vs YourMT3 0.82/0.83),
          특이 음색은 basic-pitch 폴백
  드럼:   YourMT3+ 드럼 출력 (ADTOF는 CC BY-NC-SA라 제거 — docs/licensing.md)
  음색:   PANNs Cnn14 (CC BY 4.0)
  가사:   faster-whisper (VAD, medium/int8, 가중치 MIT)
  박자:   librosa 비트 트래킹 기반 BeatGrid

사용: ml/.venv/bin/python transcribe_v2.py <audio> [sensitivity]
출력: {"bpm", "lyrics", "timbres", "tracks": {vocals|guitar|piano|other|bass: [{start,end,midi,amp,qs,qd}],
                                    drums: [{kind, slot}]}}
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

SENSITIVITY = {
    "precise": (0.55, 0.32, 90, 0.3),
    "standard": (0.45, 0.28, 70, 0.25),
    "dense": (0.4, 0.25, 60, 0.2),
}


def report(pct, stage):
    """진행률을 서버로 (원본 stderr — redirect_stderr 우회)"""
    sys.__stderr__.write(f"PROGRESS {pct} {stage}\n")
    sys.__stderr__.flush()
MELODIC_STEMS = ("vocals", "guitar", "piano", "other", "bass")
# GPU 워커(Modal 등) 배포 시 환경변수로 경로/디바이스/병렬도 재지정 가능
MODEL_DIR = os.environ.get(
    "SONGCOPY_MODEL_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ml", "models"),
)
DEVICE = os.environ.get("SONGCOPY_DEVICE", "cpu")  # 'cpu' | 'cuda'
STEM_WORKERS = int(os.environ.get("SONGCOPY_STEM_WORKERS", "2"))  # GPU에서는 1 권장


class BeatGrid:
    def __init__(self, y, sr):
        import librosa
        import numpy as np

        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beats = librosa.frames_to_time(beat_frames, sr=sr)
        if len(beats) >= 2:
            self.beats = [float(b) for b in beats]
            self.interval = float(np.median(np.diff(beats)))
        else:
            self.beats = [0.0]
            t = float(tempo if not hasattr(tempo, "__len__") else (tempo[0] if len(tempo) else 120))
            self.interval = 60.0 / (t or 120)
        while 60.0 / self.interval < 70 and len(self.beats) >= 2:
            nb = []
            for i in range(len(self.beats) - 1):
                nb.append(self.beats[i])
                nb.append((self.beats[i] + self.beats[i + 1]) / 2)
            nb.append(self.beats[-1])
            self.beats = nb
            self.interval /= 2
        while 60.0 / self.interval > 180 and len(self.beats) >= 3:
            self.beats = self.beats[::2]
            self.interval *= 2
        self.bpm = round(60.0 / self.interval)
        self.lead = round(self.beats[0] / self.interval)

    def to_slot(self, t):
        b = self.beats
        if t <= b[0]:
            beat_pos = (t - b[0]) / self.interval
        elif t >= b[-1]:
            beat_pos = (len(b) - 1) + (t - b[-1]) / self.interval
        else:
            import bisect

            i = bisect.bisect_right(b, t) - 1
            span = b[i + 1] - b[i] if b[i + 1] > b[i] else self.interval
            beat_pos = i + (t - b[i]) / span
        return max(0, round((beat_pos + self.lead) * 4))

    def dur_slots(self, start, end):
        return max(1, self.to_slot(end) - self.to_slot(start))


def clean_notes(notes):
    """배음(옥타브) 유령 제거 + 재트리거 병합 + 상대 신뢰도 필터 (v1과 동일)"""
    if not notes:
        return notes
    notes = sorted(notes, key=lambda n: (n["start"], -n["amp"]))
    merged = []
    last_by_midi = {}
    for n in notes:
        prev = last_by_midi.get(n["midi"])
        if prev and n["start"] - prev["end"] < 0.05:
            prev["end"] = max(prev["end"], n["end"])
            prev["amp"] = max(prev["amp"], n["amp"])
            continue
        item = dict(n)
        merged.append(item)
        last_by_midi[n["midi"]] = item
    result = []
    for n in merged:
        ghost = False
        for m in merged:
            if m is n or abs(m["start"] - n["start"]) > 0.06:
                continue
            if (n["midi"] - m["midi"]) % 12 == 0 and n["midi"] != m["midi"] and n["amp"] < m["amp"] * 0.75:
                ghost = True
                break
        if not ghost:
            result.append(n)
    if result:
        amps = sorted(x["amp"] for x in result)
        median = amps[len(amps) // 2]
        result = [x for x in result if not (x["amp"] < median * 0.55 and (x["end"] - x["start"]) < 0.12)]
    return result


def midi_file_to_notes(path):
    """MIDI 파일 → 노트 이벤트 (드럼 채널 제외)"""
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(path)
    notes = []
    for inst in pm.instruments:
        if inst.is_drum:
            continue
        for n in inst.notes:
            notes.append(
                {
                    "start": round(float(n.start), 4),
                    "end": round(float(n.end), 4),
                    "midi": int(n.pitch),
                    "amp": round(min(1.0, n.velocity / 127), 3),
                }
            )
    return sorted(notes, key=lambda n: n["start"])


def transcribe_yourmt3(path, sensitivity="standard"):
    """YourMT3+ 채보 (실악기 음색용 SOTA).

    촘촘(dense) 모드: 적응 전처리 + 다중 시도 — 밀집 패턴에서 누락 노트를 크게 줄인다
    (타임스트레치 여러 배율로 재시도 후 최적 결과 선택, 시간 2~4배).
    """
    import librosa
    from mt3_infer import api

    y, _ = librosa.load(path, sr=16000, mono=True)
    kwargs = {"adaptive": True, "num_attempts": 2} if sensitivity == "dense" else {}
    mid = api.transcribe(y, model="yourmt3", sr=16000, device=DEVICE if DEVICE != "cpu" else "auto", **kwargs)
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        tmp = f.name
    try:
        mid.save(tmp)
        return midi_file_to_notes(tmp)
    finally:
        os.unlink(tmp)


def transcribe_transkun(path):
    """Transkun 피아노 전용 채보 (MAESTRO F1 0.984)"""
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        tmp = f.name
    try:
        bin_dir = os.path.dirname(sys.executable)
        cmd = [os.path.join(bin_dir, "transkun"), path, tmp]
        if DEVICE != "cpu":
            cmd += ["--device", DEVICE]
        r = subprocess.run(cmd, capture_output=True, timeout=600)
        if r.returncode != 0:
            return []
        return midi_file_to_notes(tmp)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def transcribe_basic_pitch(path, sensitivity):
    """basic-pitch 폴백 (신스 등 비전형 음색)"""
    import scipy.signal

    if not hasattr(scipy.signal, "gaussian"):  # scipy 1.13+ 호환 패치 (basic-pitch 구 API 사용)
        import scipy.signal.windows

        scipy.signal.gaussian = scipy.signal.windows.gaussian
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import predict

    onset, frame, min_len, min_amp = SENSITIVITY.get(sensitivity, SENSITIVITY["standard"])
    _, _, events = predict(
        path,
        build_icassp_2022_model_path(FilenameSuffix.onnx),  # TF 대신 ONNX (py3.12 호환)
        onset_threshold=onset,
        frame_threshold=frame,
        minimum_note_length=min_len,
    )
    notes = [
        {"start": round(float(s), 4), "end": round(float(e), 4), "midi": int(p), "amp": round(float(a), 3)}
        for s, e, p, a, _b in sorted(events)
        if a >= min_amp
    ]
    return clean_notes(notes)


def transcribe_mono_f0(path, fmin_note, fmax_note, dip=0.7):
    """모노포닉 전용 채보 (보컬/베이스): pyin F0 추적 + 온셋 분할.

    벤치마크(정답 MIDI 대비 F1): 보컬 0.97 / 베이스 0.99 — YourMT3(0.82/0.83)보다
    크게 정확하고 20배 빠름. 단선율 악기에만 사용할 것 (화음 불가).
    """
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 256
    f0, voiced, _prob = librosa.pyin(
        y, fmin=librosa.note_to_hz(fmin_note), fmax=librosa.note_to_hz(fmax_note),
        sr=sr, hop_length=hop, frame_length=2048,
    )
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, units="time", backtrack=True)
    rms = librosa.feature.rms(y=y, hop_length=hop, frame_length=2048)[0]
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    midi = np.full(len(f0), -1)
    ok = voiced & ~np.isnan(f0)
    midi[ok] = np.round(librosa.hz_to_midi(f0[ok]))

    notes = []
    cur = None  # [pitch, 시작 프레임]
    for i in range(len(midi) + 1):
        p = midi[i] if i < len(midi) else -1
        if cur and p != cur[0]:
            s, e = times[cur[1]], times[min(i, len(times) - 1)]
            if e - s >= 0.07:
                amp = float(np.max(rms[cur[1]:i])) if i > cur[1] else 0.1
                notes.append({"start": round(float(s), 4), "end": round(float(e), 4),
                              "midi": int(cur[0]), "amp": round(min(1.0, amp * 8), 3)})
            cur = None
        if p >= 0 and cur is None:
            cur = [p, i]

    # 같은 음 근접 병합 (지터로 쪼개진 조각)
    merged = []
    for x in notes:
        if merged and merged[-1]["midi"] == x["midi"] and x["start"] - merged[-1]["end"] < 0.06:
            merged[-1]["end"] = x["end"]
        else:
            merged.append(x)

    # 온셋 분할: 같은 음 연타가 한 노트로 붙는 것을 쪼갬.
    # 허위 분할 방지: 분할점 직전 음량 골짜기(재어택 증거)가 있을 때만.
    def has_dip(c):
        i = int(c * sr / hop)
        pre = rms[max(0, i - 4):i + 1]
        post = rms[i + 1:i + 6]
        if len(pre) == 0 or len(post) == 0:
            return False
        return float(pre.min()) < dip * float(post.max())

    out = []
    for x in merged:
        cuts = [t for t in onsets if x["start"] + 0.08 < t < x["end"] - 0.05 and has_dip(float(t))]
        seg_start = x["start"]
        for c in cuts:
            out.append({**x, "start": round(seg_start, 4), "end": round(float(c), 4)})
            seg_start = float(c)
        out.append({**x, "start": round(seg_start, 4), "end": x["end"]})

    # 장식음 흡수: 실제 노래의 비브라토/슬라이드가 만드는 짧은 이웃음(±2반음)을
    # 붙어 있는 긴 노트에 병합 — 합성 벤치마크에는 영향 없고 실곡 파편화를 줄인다.
    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(out):
            n = out[i]
            dur = n["end"] - n["start"]
            if dur < 0.095:
                for j in (i - 1, i + 1):
                    if 0 <= j < len(out):
                        m = out[j]
                        if (
                            abs(m["midi"] - n["midi"]) <= 2
                            and (m["end"] - m["start"]) >= dur * 2
                            and (n["start"] - m["end"] < 0.05 if j < i else m["start"] - n["end"] < 0.05)
                        ):
                            # 긴 노트의 온셋은 유지 — 뒤따르는 장식음만 길이로 흡수,
                            # 앞선 장식음은 제거만 (시작점을 당기면 온셋이 어긋난다)
                            if j < i:
                                m["end"] = max(m["end"], n["end"])
                            out.pop(i)
                            changed = True
                            break
                else:
                    i += 1
                    continue
                continue
            i += 1
    return out


DRUM_KIND = {
    35: "kick", 36: "kick",
    37: "snare", 38: "snare", 40: "snare",
    42: "hat", 44: "hat", 46: "hat",
    41: "tom", 43: "tom", 45: "tom", 47: "tom", 48: "tom", 50: "tom",
    49: "cymbal", 51: "cymbal", 52: "cymbal", 53: "cymbal", 55: "cymbal", 57: "cymbal", 59: "cymbal",
}


def transcribe_drums_yourmt3(path):
    """YourMT3 드럼 채보 — 가중치 Apache-2.0 (상업 안전). 반환: [{kind, t(초)}]

    실측(실곡 드럼 스템): ADTOF와 킥 235↔240, 히트 76% 일치 — 뼈대 동일, 탐/햇을 더 잡는 경향.
    """
    import librosa
    import pretty_midi
    from mt3_infer import api

    y, _ = librosa.load(path, sr=16000, mono=True)
    mid = api.transcribe(y, model="yourmt3", sr=16000)
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        tmp = f.name
    try:
        mid.save(tmp)
        pm = pretty_midi.PrettyMIDI(tmp)
        events = []
        for inst in pm.instruments:
            if not inst.is_drum:
                continue
            for n in inst.notes:
                kind = DRUM_KIND.get(n.pitch)
                if kind:
                    events.append({"kind": kind, "t": float(n.start)})
        return events
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _worker_init():
    # 워커 2개가 코어를 나눠 쓰도록 스레드 상한 축소 (과할당 방지)
    os.environ["OMP_NUM_THREADS"] = "5"
    os.environ["MKL_NUM_THREADS"] = "5"


def _stem_task(args):
    """워커 프로세스에서 스템 하나 채보 (모델은 워커당 1회 로드 후 재사용)"""
    name, path, sensitivity = args
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        if name == "drums":
            return transcribe_drums_yourmt3(path)
        if name == "piano":
            notes = transcribe_transkun(path)
        elif name == "vocals":
            # 단선율 전용 경로 (벤치마크 F1 0.97 vs YourMT3 0.82)
            notes = transcribe_mono_f0(path, "E2", "C7", dip=0.7)
            if len(notes) < 8:
                notes = transcribe_yourmt3(path, sensitivity)
        elif name == "bass":
            notes = transcribe_mono_f0(path, "E1", "C4", dip=0.9)
            if len(notes) < 8:
                notes = transcribe_yourmt3(path, sensitivity)
        else:
            notes = transcribe_yourmt3(path, sensitivity)
        if len(notes) < 8:  # SOTA 모델이 못 잡는 음색 → basic-pitch 폴백
            notes = transcribe_basic_pitch(path, sensitivity)
        return notes


def extract_lyrics_fw(path):
    """faster-whisper (VAD로 간주 구간 환각 억제)"""
    try:
        from faster_whisper import WhisperModel

        name = os.environ.get("WHISPER_MODEL", "medium")
        try:
            model = WhisperModel(
                name,
                device=DEVICE if DEVICE != "cpu" else "cpu",
                compute_type="float16" if DEVICE == "cuda" else "int8",
            )
        except Exception:
            # GPU용 cuDNN/cuBLAS 미비 등 — CPU로 폴백 (가사가 안 나오는 것보단 느린 게 낫다)
            model = WhisperModel(name, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(
            path,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        lines = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            t = int(seg.start)
            lines.append(f"[{t // 60}:{t % 60:02d}] {text}")
        return "\n".join(lines)
    except Exception:
        return ""


def classify_timbres(stems):
    """PANNs(AudioSet 태깅)로 스템을 '듣고' 음색 판별 — 서버가 트랙 이름/GM 프로그램 결정.

    guitar: acoustic | electric | distortion
    other:  synth | strings | organ | brass | choir | flute
    """
    try:
        import librosa
        import numpy as np
        from panns_inference import AudioTagging, labels

        at = AudioTagging(checkpoint_path=None, device=DEVICE)

        def top_labels(path, topk=12):
            y, _ = librosa.load(path, sr=32000, mono=True, duration=90, offset=10)
            if len(y) < 32000:
                y, _ = librosa.load(path, sr=32000, mono=True, duration=90)
            if len(y) < 32000:
                return []
            clip, _ = at.inference(y[None, :])
            idx = np.argsort(clip[0])[::-1][:topk]
            return [(labels[i].lower(), float(clip[0][i])) for i in idx]

        out = {}
        if "guitar" in stems:
            score = {"acoustic": 0.0, "electric": 0.0, "distortion": 0.0}
            for name, s in top_labels(stems["guitar"]):
                if "distortion" in name or "heavy metal" in name:
                    score["distortion"] += s
                elif "electric guitar" in name:
                    score["electric"] += s
                elif "acoustic guitar" in name:
                    score["acoustic"] += s
            best = max(score, key=lambda k: score[k])
            if score[best] > 0.03:
                out["guitar"] = best
        if "other" in stems:
            fam = {k: 0.0 for k in ("strings", "organ", "brass", "choir", "flute", "synth")}
            for name, s in top_labels(stems["other"]):
                if any(w in name for w in ("violin", "cello", "string", "orchestra", "harp")):
                    fam["strings"] += s
                elif "organ" in name:
                    fam["organ"] += s
                elif any(w in name for w in ("brass", "trumpet", "trombone", "horn", "saxophone")):
                    fam["brass"] += s
                elif any(w in name for w in ("choir", "chant", "singing")):
                    fam["choir"] += s
                elif "flute" in name:
                    fam["flute"] += s
                elif "synth" in name or "electronic" in name:
                    fam["synth"] += s
            best = max(fam, key=lambda k: fam[k])
            out["other"] = best if fam[best] > 0.05 else "synth"
        return out
    except Exception:
        return {}


def stem_has_content(path):
    import librosa
    import numpy as np

    y, _sr = librosa.load(path, mono=True, duration=120)
    return len(y) > 0 and float(np.sqrt(np.mean(y**2))) > 0.003


def separate_mvsep(audio, outdir):
    """MVSep API로 BS Roformer SW(sep_type 61) 분리 — 출력물 상업 이용 허용(MVSep Terms §7).

    MVSEP_API_KEY 환경변수 필요. 업로드 → 해시 폴링 → 스템 다운로드.
    """
    import time
    import requests

    token = os.environ["MVSEP_API_KEY"]
    with open(audio, "rb") as f:
        r = requests.post(
            "https://mvsep.com/api/separation/create",
            data={"api_token": token, "sep_type": "61"},
            files={"audiofile": f},
            timeout=300,
        )
    r.raise_for_status()
    j = r.json()
    if not j.get("success"):
        raise RuntimeError(f"mvsep create 실패: {j}")
    job_hash = j["data"]["hash"]

    deadline = time.time() + 1200
    while time.time() < deadline:
        time.sleep(8)
        g = requests.get("https://mvsep.com/api/separation/get", params={"hash": job_hash}, timeout=60).json()
        status = g.get("status")
        if status == "done":
            stems = {}
            for item in g.get("data", {}).get("files", []):
                url = item.get("url") or item.get("download")
                if not url:
                    continue
                label = " ".join(str(item.get(k, "")) for k in ("type", "name", "stem")).lower() + " " + url.lower()
                for name in (*MELODIC_STEMS, "drums"):
                    if name in label and name not in stems:
                        path = os.path.join(outdir, f"{name}.wav")
                        with requests.get(url, stream=True, timeout=600) as dl:
                            dl.raise_for_status()
                            with open(path, "wb") as out:
                                for chunk in dl.iter_content(1 << 16):
                                    out.write(chunk)
                        stems[name] = path
            if stems:
                return stems
            raise RuntimeError(f"mvsep: 스템을 찾지 못함 — 응답 구조 확인 필요: {g}")
        if status in ("failed", "error", "not_found"):
            raise RuntimeError(f"mvsep 작업 실패: {g}")
    raise RuntimeError("mvsep 대기 시간 초과 (20분)")


def separate(audio, outdir):
    """6스템 분리 → {stem: path}.

    MVSEP_API_KEY 있으면 API(상업 안전), 없으면 로컬 BS-Roformer-SW
    (개발 전용 — 가중치 라이선스 불명이라 상업 서비스에서는 키 필수).
    """
    if os.environ.get("MVSEP_API_KEY"):
        return separate_mvsep(audio, outdir)

    from audio_separator.separator import Separator

    sep = Separator(output_dir=outdir, model_file_dir=MODEL_DIR, log_level=40)
    sep.load_model(model_filename="BS-Roformer-SW.ckpt")
    files = sep.separate(audio)
    stems = {}
    for f in files:
        full = f if os.path.isabs(f) else os.path.join(outdir, f)
        low = os.path.basename(full).lower()
        for name in (*MELODIC_STEMS, "drums"):
            if f"({name})" in low:
                stems[name] = full
    return stems


def main() -> None:
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        print(json.dumps({"error": "audio file required"}))
        sys.exit(1)
    audio = sys.argv[1]
    sensitivity = sys.argv[2] if len(sys.argv) > 2 else "standard"

    buf = io.StringIO()
    out = {
        "bpm": None,
        "lyrics": "",
        "engine": "v2",
        "timbres": {},
        "tracks": {k: [] for k in (*MELODIC_STEMS, "drums")},
    }
    tmpdir = tempfile.mkdtemp(prefix="songcopy-v2-")
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            import librosa

            report(3, "오디오 분석 (BPM)")
            y, sr = librosa.load(audio, mono=True)
            grid = BeatGrid(y, sr)
            out["bpm"] = grid.bpm

            report(8, "악기 분리 (6스템)")
            stems = separate(audio, tmpdir)
            report(35, "음색 판별")
            out["timbres"] = classify_timbres(stems)

            STEM_LABEL = {
                "vocals": "보컬", "guitar": "기타", "piano": "피아노",
                "other": "신스", "bass": "베이스", "drums": "드럼",
            }
            tasks = [
                (n, stems[n], sensitivity)
                for n in (*MELODIC_STEMS, "drums")
                if stems.get(n) and stem_has_content(stems[n])
            ]
            def collect(name, result):
                if name == "drums":
                    events = [{"kind": e["kind"], "slot": grid.to_slot(e["t"])} for e in result]
                    if len(events) >= 8:
                        out["tracks"]["drums"] = events
                elif len(result) >= 8:
                    for n in result:
                        n["qs"] = grid.to_slot(n["start"])
                        n["qd"] = grid.dur_slots(n["start"], n["end"])
                    out["tracks"][name] = result

            done_ct = 0
            if STEM_WORKERS <= 1:
                # GPU 등 단일 컨텍스트: 프로세스 안에서 순차 (모델/CUDA 재사용)
                report(38, "악기별 채보")
                for t in tasks:
                    try:
                        result = _stem_task(t)
                        collect(t[0], result)
                    except Exception:
                        import traceback

                        traceback.print_exc(file=sys.__stderr__)
                    done_ct += 1
                    report(
                        38 + round(50 * done_ct / max(1, len(tasks))),
                        f"{STEM_LABEL.get(t[0], t[0])} 채보 완료 ({done_ct}/{len(tasks)})",
                    )
            else:
                report(38, f"악기별 채보 ({STEM_WORKERS}개 병렬)")
                import concurrent.futures as cf

                with cf.ProcessPoolExecutor(max_workers=STEM_WORKERS, initializer=_worker_init) as pool:
                    futures = {pool.submit(_stem_task, t): t[0] for t in tasks}
                    for fut in cf.as_completed(futures):
                        name = futures[fut]
                        done_ct += 1
                        report(
                            38 + round(50 * done_ct / max(1, len(tasks))),
                            f"{STEM_LABEL.get(name, name)} 채보 완료 ({done_ct}/{len(tasks)})",
                        )
                        try:
                            collect(name, fut.result())
                        except Exception:
                            import traceback

                            traceback.print_exc(file=sys.__stderr__)
                            continue

            if out["tracks"]["vocals"]:
                report(90, "가사 추출")
                out["lyrics"] = extract_lyrics_fw(stems["vocals"])
            report(97, "악보 생성")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
