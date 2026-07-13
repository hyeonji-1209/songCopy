# 채보 모델 정확도 회귀 벤치마크 (정답 MIDI 대비 F1)
#
# 준비(1회): GeneralUser GS 사운드폰트를 이 디렉토리에 GeneralUser.sf2로 받고
#            brew install fluid-synth 후  ../../ml/.venv/bin/python bench_make.py
#            (사운드폰트: https://github.com/mrbumpy409/GeneralUser-GS — 32MB라 커밋 안 함)
# 실행:      ../../ml/.venv/bin/python bench_eval.py [stem ...]   (기본: 전부)
#
# 2026-07-13 기준 결과 (합성 밴드 곡, onset 50ms):
#   melody: pyin(전용) 0.97 | yourmt3 0.82 | basic_pitch 0.20
#   guitar: yourmt3 0.61 (최선 — 폴리포닉 기타는 SOTA 한계)
#   bass:   pyin(전용) 0.99 | yourmt3 0.83
#   piano:  transkun 1.00 | yourmt3 0.98
#   drums:  yourmt3 킥/스네어/심벌 1.0, 햇 0.99, 탐 0.90
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import numpy as np
import mir_eval

import transcribe_v2 as T


def to_arrays(notes, key="midi"):
    if not notes:
        return np.zeros((0, 2)), np.array([])
    iv = np.array([[x["start"], max(x["end"], x["start"] + 0.05)] for x in notes])
    hz = np.array([440.0 * 2 ** ((x[key] - 69) / 12) for x in notes])
    return iv, hz


def score(gt_notes, pred_notes):
    ri, rp = to_arrays(gt_notes, key="pitch")
    ei, ep = to_arrays(pred_notes)
    if len(ep) == 0:
        return 0.0, 0.0, 0.0
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ri, rp, ei, ep, onset_tolerance=0.05, offset_ratio=None
    )
    return round(p, 3), round(r, 3), round(f, 3)


def drum_score(gt_events, pred_events, tol=0.05):
    """클래스별 onset 매칭 F1: {kind: (P, R, F1, 정답수, 예측수)}"""
    out = {}
    kinds = sorted(
        {T.DRUM_KIND[e["pitch"]] for e in gt_events if e["pitch"] in T.DRUM_KIND}
        | {e["kind"] for e in pred_events}
    )
    gt_by = {}
    for e in gt_events:
        k = T.DRUM_KIND.get(e["pitch"])
        if k:
            gt_by.setdefault(k, []).append(e["start"])
    pr_by = {}
    for e in pred_events:
        pr_by.setdefault(e["kind"], []).append(e["t"])
    for k in kinds:
        ref, est = sorted(gt_by.get(k, [])), sorted(pr_by.get(k, []))
        used = [False] * len(est)
        hit = 0
        for t in ref:
            for j, u in enumerate(est):
                if not used[j] and abs(u - t) <= tol:
                    used[j] = True
                    hit += 1
                    break
        p = hit / len(est) if est else 0
        r = hit / len(ref) if ref else 0
        f = 2 * p * r / (p + r) if p + r else 0
        out[k] = (round(p, 2), round(r, 2), round(f, 2), len(ref), len(est))
    return out


CANDIDATES = {
    "melody": [
        ("pyin(현재)", lambda p: T.transcribe_mono_f0(p, "E2", "C7", dip=0.7)),
        ("yourmt3", lambda p: T.transcribe_yourmt3(p)),
    ],
    "guitar": [
        ("yourmt3(현재)", lambda p: T.transcribe_yourmt3(p)),
    ],
    "bass": [
        ("pyin(현재)", lambda p: T.transcribe_mono_f0(p, "E1", "C4", dip=0.9)),
        ("yourmt3", lambda p: T.transcribe_yourmt3(p)),
    ],
    "piano": [
        ("transkun(현재)", lambda p: T.transcribe_transkun(p)),
    ],
}


def main():
    GT = json.load(open(os.path.join(HERE, "bench_gt.json")))
    stems = sys.argv[1:] or ["melody", "guitar", "bass", "piano", "drums"]
    for stem in stems:
        wav = os.path.join(HERE, f"bench_{stem}.wav")
        if stem == "drums":
            t0 = time.time()
            pred = T.transcribe_drums_yourmt3(wav)
            print(f"drums/yourmt3 ({time.time()-t0:.0f}s):", drum_score(GT["drums"], pred), flush=True)
            continue
        for name, fn in CANDIDATES[stem]:
            t0 = time.time()
            pred = fn(wav)
            print(
                f"{stem}/{name} ({time.time()-t0:.0f}s): P/R/F1={score(GT[stem], pred)} "
                f"pred={len(pred)} gt={len(GT[stem])}", flush=True,
            )


if __name__ == "__main__":
    main()
