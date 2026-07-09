#!/usr/bin/env python3
"""AI 채보 파이프라인 v2 — 2026 오픈소스 SOTA 스택 (ml/.venv 전용).

  분리:   BS-Roformer-SW (audio-separator) — 보컬/기타/피아노/베이스/other/드럼 6스템
  채보:   YourMT3+ (mt3-infer) 주력, 피아노는 Transkun, 0노트 시 basic-pitch 폴백
  드럼:   ADTOF-pytorch — 킥/스네어/햇/탐/심벌 5클래스
  가사:   faster-whisper (VAD, medium/int8)
  박자:   librosa 비트 트래킹 기반 BeatGrid (v1과 동일 방식)

사용: ml/.venv/bin/python transcribe_v2.py <audio> [sensitivity]
출력: {"bpm", "lyrics", "tracks": {vocals|guitar|piano|other|bass: [{start,end,midi,amp,qs,qd}],
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
MELODIC_STEMS = ("vocals", "guitar", "piano", "other", "bass")
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ml", "models")


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


def transcribe_yourmt3(path):
    """YourMT3+ 채보 (실악기 음색용 SOTA)"""
    import librosa
    from mt3_infer import api

    y, _ = librosa.load(path, sr=16000, mono=True)
    mid = api.transcribe(y, model="yourmt3", sr=16000)
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
        r = subprocess.run(
            [os.path.join(bin_dir, "transkun"), path, tmp],
            capture_output=True,
            timeout=600,
        )
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


def transcribe_drums_adtof(path, grid):
    """ADTOF — 실음원 학습 드럼 채보 (킥/스네어/햇/탐/심벌)"""
    from adtof_pytorch import transcribe_to_midi
    import pretty_midi

    kind_map = {35: "kick", 36: "kick", 38: "snare", 42: "hat", 46: "hat", 47: "tom", 49: "cymbal", 51: "cymbal"}
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
        tmp = f.name
    try:
        transcribe_to_midi(path, tmp)
        pm = pretty_midi.PrettyMIDI(tmp)
        events = []
        for inst in pm.instruments:
            for n in inst.notes:
                kind = kind_map.get(n.pitch)
                if kind:
                    events.append({"kind": kind, "slot": grid.to_slot(float(n.start))})
        return events
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def extract_lyrics_fw(path):
    """faster-whisper (VAD로 간주 구간 환각 억제)"""
    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(os.environ.get("WHISPER_MODEL", "medium"), compute_type="int8")
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

        at = AudioTagging(checkpoint_path=None, device="cpu")

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


def separate(audio, outdir):
    """BS-Roformer-SW 6스템 분리 → {stem: path}"""
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

            y, sr = librosa.load(audio, mono=True)
            grid = BeatGrid(y, sr)
            out["bpm"] = grid.bpm

            stems = separate(audio, tmpdir)
            out["timbres"] = classify_timbres(stems)

            for name in MELODIC_STEMS:
                path = stems.get(name)
                if not path or not stem_has_content(path):
                    continue
                try:
                    if name == "piano":
                        notes = transcribe_transkun(path)
                    else:
                        notes = transcribe_yourmt3(path)
                    if len(notes) < 8:  # SOTA 모델이 못 잡는 음색 → basic-pitch 폴백
                        notes = transcribe_basic_pitch(path, sensitivity)
                    if len(notes) >= 8:
                        for n in notes:
                            n["qs"] = grid.to_slot(n["start"])
                            n["qd"] = grid.dur_slots(n["start"], n["end"])
                        out["tracks"][name] = notes
                except Exception:
                    pass

            if "drums" in stems and stem_has_content(stems["drums"]):
                try:
                    drums = transcribe_drums_adtof(stems["drums"], grid)
                    if len(drums) >= 8:
                        out["tracks"]["drums"] = drums
                except Exception:
                    pass

            if out["tracks"]["vocals"]:
                out["lyrics"] = extract_lyrics_fw(stems["vocals"])
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
