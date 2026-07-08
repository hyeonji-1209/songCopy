#!/usr/bin/env python3
"""오디오 파일 → 노트 이벤트 JSON (basic-pitch).

사용: python3 transcribe.py <audio-file>
출력(stdout): {"notes": [{"start": s, "end": s, "midi": n, "amp": a}, ...]}
"""
import contextlib
import io
import json
import os
import sys


def main() -> None:
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        print(json.dumps({"error": "audio file required"}))
        sys.exit(1)

    # basic-pitch(CoreML 백엔드)가 stdout에 디버그를 찍으므로 격리한다
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        from basic_pitch.inference import predict

        _, _, note_events = predict(sys.argv[1])

    notes = [
        {"start": round(float(s), 4), "end": round(float(e), 4), "midi": int(p), "amp": round(float(a), 3)}
        for s, e, p, a, _bends in sorted(note_events)
        if a >= 0.3  # 저신뢰 노트 제거
    ]
    print(json.dumps({"notes": notes}))


if __name__ == "__main__":
    main()
