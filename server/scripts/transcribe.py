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


def notes_from(events, min_amp=0.2):
    return [
        {"start": round(float(s), 4), "end": round(float(e), 4), "midi": int(p), "amp": round(float(a), 3)}
        for s, e, p, a, _bends in sorted(events)
        if a >= min_amp
    ]


def predict_dense(predict, path):
    """민감도를 높인 채보: 낮은 임계값 + 짧은 음(60ms) 허용 → 최대한 많은 음을 잡는다."""
    _, _, ev = predict(
        path,
        onset_threshold=0.4,
        frame_threshold=0.25,
        minimum_note_length=60,
    )
    return ev


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
                        ev = predict_dense(predict, path)
                        notes = notes_from(ev, 0.25 if name != "bass" else 0.2)
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
                ev = predict_dense(predict, audio)
                out["tracks"]["other"] = notes_from(ev)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
