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


def classify_drums(path):
    import librosa
    import numpy as np

    y, sr = librosa.load(path, mono=True)
    if float(np.abs(y).max() or 0) < 1e-3:
        return []
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=False, delta=0.04)
    events = []
    for t in onsets:
        i0 = int(t * sr)
        seg = y[i0 : i0 + int(0.06 * sr)]
        if len(seg) < 64:
            continue
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        freqs = np.fft.rfftfreq(len(seg), 1 / sr)
        total = spec.sum() + 1e-9
        low = spec[freqs < 150].sum() / total
        mid = spec[(freqs >= 150) & (freqs < 1200)].sum() / total
        high = spec[freqs > 5000].sum() / total
        if low > 0.3:
            kind = "kick"
        elif high > 0.5 and mid < 0.25:
            kind = "hat"
        else:
            kind = "snare"
        events.append({"time": round(float(t), 4), "kind": kind})
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
            try:
                import librosa

                y, sr = librosa.load(audio, mono=True)
                tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
                t = float(tempo if not hasattr(tempo, "__len__") else tempo[0])
                while 0 < t < 70:
                    t *= 2
                while t > 180:
                    t /= 2
                if t > 0:
                    out["bpm"] = round(t)
            except Exception:
                pass

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
                            out["tracks"][name] = notes
                    except Exception:
                        pass
                if "drums" in stems and stem_has_content(stems["drums"]):
                    try:
                        drums = classify_drums(stems["drums"])
                        if len(drums) >= 8:
                            out["tracks"]["drums"] = drums
                    except Exception:
                        pass
                if out["tracks"]["vocals"]:
                    out["lyrics"] = extract_lyrics(stems["vocals"])
            else:
                out["tracks"]["other"] = predict_notes(predict, audio, sensitivity)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
