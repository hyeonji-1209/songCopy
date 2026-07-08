#!/usr/bin/env python3
"""오디오 파일 → 악기 감지 + 멀티트랙 노트 이벤트 + 가사 JSON.

파이프라인:
  demucs htdemucs_6s (6스템: vocals/guitar/piano/bass/other/drums)
  → 스템별 존재 여부 판단(에너지·노트 수) → 있는 악기만 basic-pitch 채보
  → 드럼: 온셋 검출 + 킥/스네어/햇 분류
  → 보컬 있으면 Whisper로 가사(타임스탬프) 추출
  → librosa BPM 감지

출력(stdout): {"bpm": n|null, "lyrics": "...",
  "tracks": {"vocals":[], "guitar":[], "piano":[], "other":[], "bass":[], "drums":[]}}
"""
import contextlib
import glob
import io
import json
import os
import shutil
import sys
import tempfile

MELODIC_STEMS = ("vocals", "guitar", "piano", "other", "bass")


# 민감도 프리셋: (onset, frame, 최소음길이ms, 최소amp)
SENSITIVITY = {
    "precise": (0.55, 0.32, 90, 0.3),
    "standard": (0.45, 0.28, 70, 0.25),
    "dense": (0.4, 0.25, 60, 0.2),
}


def notes_from(events, min_amp):
    return [
        {"start": round(float(s), 4), "end": round(float(e), 4), "midi": int(p), "amp": round(float(a), 3)}
        for s, e, p, a, _bends in sorted(events)
        if a >= min_amp
    ]


def clean_notes(notes):
    """유령 노트 정리: 배음(옥타브) 오검출 제거 + 재트리거 병합 + 상대 신뢰도 필터."""
    if not notes:
        return notes
    notes = sorted(notes, key=lambda n: (n["start"], -n["amp"]))

    # 1) 같은 음 재트리거 병합 (50ms 이내 끊김)
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

    # 2) 옥타브 배음 유령 제거: 동시 시작(±60ms) + 옥타브 관계 + 확연히 약함
    result = []
    for i, n in enumerate(merged):
        ghost = False
        for m in merged:
            if m is n:
                continue
            if abs(m["start"] - n["start"]) > 0.06:
                continue
            if (n["midi"] - m["midi"]) % 12 == 0 and n["midi"] != m["midi"] and n["amp"] < m["amp"] * 0.75:
                ghost = True
                break
        if not ghost:
            result.append(n)

    # 3) 상대 신뢰도: 트랙 중앙값의 55% 미만이면서 120ms 미만인 짧고 약한 음 제거
    if result:
        amps = sorted(x["amp"] for x in result)
        median = amps[len(amps) // 2]
        result = [
            x for x in result if not (x["amp"] < median * 0.55 and (x["end"] - x["start"]) < 0.12)
        ]
    return result


def predict_notes(predict, path, sensitivity):
    onset, frame, min_len, min_amp = SENSITIVITY.get(sensitivity, SENSITIVITY["standard"])
    _, _, ev = predict(
        path,
        onset_threshold=onset,
        frame_threshold=frame,
        minimum_note_length=min_len,
    )
    return clean_notes(notes_from(ev, min_amp))


def stem_has_content(path):
    """스템에 실제 소리가 있는지 (RMS 에너지 기준)"""
    import numpy as np
    import librosa

    y, _sr = librosa.load(path, mono=True, duration=120)
    if len(y) == 0:
        return False
    rms = float(np.sqrt(np.mean(y**2)))
    return rms > 0.004


class BeatGrid:
    """실제 비트 시각 기반 양자화: 템포 드리프트·인트로 오프셋에 강함.

    시각 t → 16분음표 단위 슬롯 (비트당 4슬롯).
    """

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
        # 절반/두 배 템포 락 보정: 그리드 자체를 세분화/솎아내기 (표시 BPM과 음길이가 함께 맞음)
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
        # 첫 감지 비트 이전 구간(인트로)도 같은 간격으로 역외삽 — 0초 근처가 슬롯 0
        self.lead = round(self.beats[0] / self.interval)

    def to_slot(self, t):
        """시각 → 16분 슬롯 (비트 사이는 해당 비트 길이로 보간)"""
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


def detect_drums(path, grid):
    """드럼 스템 → 대역별 독립 온셋 검출 (동시 타격 포착).

    킥 = 저역(<120Hz), 스네어 = 중역(150~2k), 햇 = 고역(>5k) 각각 따로 검출.
    """
    import librosa
    import numpy as np
    from scipy.signal import butter, sosfiltfilt

    y, sr = librosa.load(path, mono=True)
    if float(np.abs(y).max() or 0) < 1e-3:
        return []

    def band(lo, hi):
        if lo is None:
            sos = butter(4, hi, "low", fs=sr, output="sos")
        elif hi is None:
            sos = butter(4, lo, "high", fs=sr, output="sos")
        else:
            sos = butter(4, [lo, hi], "band", fs=sr, output="sos")
        return sosfiltfilt(sos, y).astype("float32")

    # 후보 온셋 = 세 대역 온셋의 합집합, 각 후보마다 어떤 대역이 실제로 울렸는지 판정
    bands = {"kick": band(None, 120), "snare": band(150, 2000), "hat": band(5000, None)}
    envs = {k: np.abs(v) for k, v in bands.items()}
    peaks = {k: float(v.max() or 1e-9) for k, v in envs.items()}

    cands = []
    for sig in bands.values():
        cands.extend(librosa.onset.onset_detect(y=sig, sr=sr, units="time", backtrack=False))
    cands.sort()
    merged_t = []
    for t in cands:
        if not merged_t or t - merged_t[-1] >= 0.04:
            merged_t.append(float(t))

    win = int(0.05 * sr)
    events = []
    for t in merged_t:
        i0 = int(t * sr)
        # 대역별 정규화 진폭 (자기 대역 피크 기준) — 다른 악기의 새는 소리는 작게 나온다
        vals = {k: float(envs[k][i0 : i0 + win].max() or 0) / peaks[k] for k in bands}
        top = max(vals.values())
        if top < 0.2:
            continue
        slot = grid.to_slot(t)
        for kind, v in vals.items():
            if v < 0.32:
                continue
            # 중역(스네어)만 교차 우세 검사 — 킥/햇의 새는 소리에 취약한 대역
            if kind == "snare" and v < top * 0.6:
                continue
            events.append({"kind": kind, "slot": slot})
    return events


def extract_lyrics(vocals_path):
    """보컬 스템 → Whisper 가사 (타임스탬프 라인). librosa로 로드해 ffmpeg 의존 제거."""
    try:
        import librosa
        import whisper

        y, _sr = librosa.load(vocals_path, sr=16000, mono=True)
        if len(y) < 16000:
            return ""
        model = whisper.load_model("base")
        result = model.transcribe(y, fp16=False)
        lines = []
        for seg in result.get("segments", []):
            text = seg.get("text", "").strip()
            if not text:
                continue
            t = int(seg["start"])
            lines.append(f"[{t // 60}:{t % 60:02d}] {text}")
        return "\n".join(lines)
    except Exception:
        return ""


def main() -> None:
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        print(json.dumps({"error": "audio file required"}))
        sys.exit(1)
    audio = sys.argv[1]
    sensitivity = sys.argv[2] if len(sys.argv) > 2 else "standard"

    buf = io.StringIO()
    out = {"bpm": None, "lyrics": "", "tracks": {k: [] for k in (*MELODIC_STEMS, "drums")}}
    tmpdir = tempfile.mkdtemp(prefix="songcopy-sep-")
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            # 비트 그리드: 원본 믹스의 실제 비트 위치 기반 (템포 드리프트·인트로 오프셋 보정)
            import librosa

            y, sr = librosa.load(audio, mono=True)
            grid = BeatGrid(y, sr)
            out["bpm"] = grid.bpm

            from basic_pitch.inference import predict

            stems = {}
            try:
                from demucs.separate import main as demucs_main

                demucs_main(["-n", "htdemucs_6s", "-o", tmpdir, audio])
                for f in glob.glob(os.path.join(tmpdir, "htdemucs_6s", "*", "*.wav")):
                    stems[os.path.splitext(os.path.basename(f))[0]] = f
            except Exception:
                stems = {}

            if stems:
                for name in MELODIC_STEMS:
                    path = stems.get(name)
                    if not path or not stem_has_content(path):
                        continue
                    try:
                        notes = predict_notes(predict, path, sensitivity)
                        if len(notes) >= 8:  # 존재 판단: 유의미한 노트 수
                            for n in notes:  # 비트 그리드 슬롯 부여
                                n["qs"] = grid.to_slot(n["start"])
                                n["qd"] = grid.dur_slots(n["start"], n["end"])
                            out["tracks"][name] = notes
                    except Exception:
                        pass
                if "drums" in stems and stem_has_content(stems["drums"]):
                    try:
                        drums = detect_drums(stems["drums"], grid)
                        if len(drums) >= 8:
                            out["tracks"]["drums"] = drums
                    except Exception:
                        pass
                if out["tracks"]["vocals"]:
                    out["lyrics"] = extract_lyrics(stems["vocals"])
            else:
                notes = predict_notes(predict, audio, sensitivity)
                for n in notes:
                    n["qs"] = grid.to_slot(n["start"])
                    n["qd"] = grid.dur_slots(n["start"], n["end"])
                out["tracks"]["other"] = notes
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
