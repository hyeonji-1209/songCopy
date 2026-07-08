#!/usr/bin/env python3
"""오디오 파일 → 멀티트랙 노트 이벤트 JSON.

파이프라인: demucs(4스템 분리) → basic-pitch(보컬/기타/베이스 채보)
           + 드럼 스템 온셋 검출·분류(킥/스네어/햇) + librosa BPM 감지

사용: python3 transcribe.py <audio-file>
출력(stdout): {"bpm": n|null, "tracks": {"vocals": [...], "other": [...], "bass": [...],
               "drums": [{"time": s, "kind": "kick"|"snare"|"hat"}]}}
노트: {"start": s, "end": s, "midi": n, "amp": a}
"""
import contextlib
import glob
import io
import json
import os
import shutil
import sys
import tempfile


def notes_from(events, min_amp=0.3):
    return [
        {"start": round(float(s), 4), "end": round(float(e), 4), "midi": int(p), "amp": round(float(a), 3)}
        for s, e, p, a, _bends in sorted(events)
        if a >= min_amp
    ]


def classify_drums(path):
    """드럼 스템에서 온셋 검출 후 스펙트럼 대역으로 킥/스네어/햇 분류."""
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


def main() -> None:
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        print(json.dumps({"error": "audio file required"}))
        sys.exit(1)
    audio = sys.argv[1]

    buf = io.StringIO()
    out = {"bpm": None, "tracks": {"vocals": [], "other": [], "bass": [], "drums": []}}
    tmpdir = tempfile.mkdtemp(prefix="songcopy-sep-")
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            # BPM (원본 믹스 기준)
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

            # 스템 분리 (실패 시 전체를 'other'로 단일 채보)
            stems = {}
            try:
                from demucs.separate import main as demucs_main

                demucs_main(["-n", "htdemucs", "-o", tmpdir, audio])
                for f in glob.glob(os.path.join(tmpdir, "htdemucs", "*", "*.wav")):
                    stems[os.path.splitext(os.path.basename(f))[0]] = f
            except Exception:
                stems = {}

            if stems:
                for name in ("vocals", "other", "bass"):
                    if name in stems:
                        try:
                            _, _, ev = predict(stems[name])
                            out["tracks"][name] = notes_from(ev, 0.35 if name != "bass" else 0.3)
                        except Exception:
                            pass
                if "drums" in stems:
                    try:
                        out["tracks"]["drums"] = classify_drums(stems["drums"])
                    except Exception:
                        pass
            else:
                _, _, ev = predict(audio)
                out["tracks"]["other"] = notes_from(ev)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
