# 벤치마크 곡 생성: 정답 MIDI + 스템별 wav 렌더 (fluidsynth)
# 32마디, 120bpm, G장조, 밴드 편성 (멜로디/기타/베이스/피아노/드럼)
import json
import os
import subprocess

import pretty_midi

BPM = 120.0
BEAT = 60.0 / BPM  # 0.5s
BAR = BEAT * 4

pm = pretty_midi.PrettyMIDI(initial_tempo=BPM)

# G major: G A B C D E F#
# 진행: G - Em - C - D (4마디 단위 반복)
CHORDS = {
    "G": [55, 59, 62, 67],   # G3 B3 D4 G4
    "Em": [52, 55, 59, 64],  # E3 G3 B3 E4
    "C": [48, 52, 55, 60],   # C3 E3 G3 C4
    "D": [50, 54, 57, 62],   # D3 F#3 A3 D4
}
PROG = ["G", "Em", "C", "D"] * 8  # 32마디
ROOTS = {"G": 43, "Em": 40, "C": 36, "D": 38}  # 베이스 루트 (G2 E2 C2 D2)

def n(inst, pitch, start, dur, vel=96):
    inst.notes.append(pretty_midi.Note(velocity=vel, pitch=pitch, start=start, end=start + dur))

# ---- 멜로디 (보컬 대역, 모노포닉) ----
melody = pretty_midi.Instrument(program=53, name="melody")  # voice oohs
# 8마디 프레이즈 (음: 슬롯 단위 16분), (pitch, slot, len_slots)
PHRASE = [
    (67, 0, 4), (69, 4, 2), (71, 6, 2), (74, 8, 6), (71, 14, 2),   # 마디1
    (72, 16, 4), (71, 20, 2), (69, 22, 2), (67, 24, 8),            # 마디2
    (64, 32, 4), (67, 36, 4), (69, 40, 3), (67, 43, 1), (66, 44, 4),  # 마디3
    (62, 48, 4), (64, 52, 2), (66, 54, 2), (67, 56, 8),            # 마디4
]
for rep in range(4):  # 4회 반복 = 16마디 노래 + 나머지 반복
    base = rep * 8 * BAR
    for p, slot, ln in PHRASE:
        st = base + slot * BEAT / 4
        n(melody, p, st, ln * BEAT / 4 * 0.95, vel=100)
    # 두 번째 4마디는 한 옥타브 위 응답 프레이즈 (변화)
    for p, slot, ln in PHRASE:
        st = base + 4 * BAR + slot * BEAT / 4
        n(melody, min(p + 5, 79), st, ln * BEAT / 4 * 0.95, vel=90)
pm.instruments.append(melody)

# ---- 기타 (스트럼 + 아르페지오 교대) ----
guitar = pretty_midi.Instrument(program=27, name="guitar")  # clean electric
for bar, ch in enumerate(PROG):
    t0 = bar * BAR
    notes = CHORDS[ch]
    if bar % 8 < 4:
        # 스트럼: 1박·3박 다운(4음), 2박반·4박 업(상위 2음)
        for beat_off, pitches, vel in [
            (0.0, notes, 100), (1.5, notes[2:], 80), (2.0, notes, 95), (3.5, notes[2:], 80),
        ]:
            for k, p in enumerate(pitches):
                n(guitar, p, t0 + beat_off * BEAT + k * 0.012, BEAT * 0.9, vel)
    else:
        # 아르페지오 8분음표
        order = [0, 1, 2, 3, 2, 1, 2, 3]
        for k, idx in enumerate(order):
            n(guitar, notes[idx], t0 + k * BEAT / 2, BEAT / 2 * 0.9, 88)
pm.instruments.append(guitar)

# ---- 베이스 (루트-5도 8분 라인) ----
bass = pretty_midi.Instrument(program=33, name="bass")
for bar, ch in enumerate(PROG):
    t0 = bar * BAR
    r = ROOTS[ch]
    line = [r, r, r + 7, r, r + 12, r + 7, r, r + 7]  # 8분음표
    for k, p in enumerate(line):
        n(bass, p, t0 + k * BEAT / 2, BEAT / 2 * 0.85, 100)
pm.instruments.append(bass)

# ---- 피아노 (컴핑) ----
piano = pretty_midi.Instrument(program=0, name="piano")
for bar, ch in enumerate(PROG):
    t0 = bar * BAR
    notes = [p + 12 for p in CHORDS[ch]]
    n(piano, notes[0] - 24, t0, BAR * 0.95, 70)  # 왼손 루트
    for beat_off in (0.0, 2.5, 3.0):
        for p in notes[1:]:
            n(piano, p, t0 + beat_off * BEAT, BEAT * 0.8, 78)
pm.instruments.append(piano)

# ---- 드럼 (락 기본 + 4마디마다 필인) ----
drums = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
for bar in range(32):
    t0 = bar * BAR
    for k in range(8):  # 하이햇 8분
        n(drums, 42, t0 + k * BEAT / 2, 0.1, 80 if k % 2 else 95)
    n(drums, 36, t0, 0.1, 110)                 # 킥 1박
    n(drums, 36, t0 + 2.5 * BEAT, 0.1, 100)    # 킥 3박반
    n(drums, 38, t0 + 1 * BEAT, 0.1, 105)      # 스네어 2박
    n(drums, 38, t0 + 3 * BEAT, 0.1, 105)      # 스네어 4박
    if bar % 4 == 3:  # 필인: 4박 16분 탐
        for k, tom in enumerate([48, 47, 45, 43]):
            n(drums, tom, t0 + 3 * BEAT + k * BEAT / 4, 0.1, 100)
    if bar % 8 == 0:
        n(drums, 49, t0, 0.3, 100)  # 크래시
pm.instruments.append(drums)

OUT = os.path.dirname(os.path.abspath(__file__))
mid_path = os.path.join(OUT, "bench.mid")
pm.write(mid_path)

# 정답 노트 JSON (스템별)
gt = {}
for inst in pm.instruments:
    key = inst.name
    if inst.is_drum:
        gt[key] = [{"pitch": x.pitch, "start": round(x.start, 4)} for x in inst.notes]
    else:
        gt[key] = [
            {"pitch": x.pitch, "start": round(x.start, 4), "end": round(x.end, 4)} for x in inst.notes
        ]
with open(os.path.join(OUT, "bench_gt.json"), "w") as f:
    json.dump(gt, f)

# 스템별 solo MIDI → wav 렌더 + 풀믹스
SF2 = os.path.join(OUT, "GeneralUser.sf2")


def render(mid, wav):
    subprocess.run(
        ["fluidsynth", "-ni", "-F", wav, "-r", "44100", "-g", "0.7", SF2, mid],
        check=True, capture_output=True,
    )


for inst in pm.instruments:
    solo = pretty_midi.PrettyMIDI(initial_tempo=BPM)
    solo.instruments.append(inst)
    sp = os.path.join(OUT, f"bench_{inst.name}.mid")
    solo.write(sp)
    render(sp, os.path.join(OUT, f"bench_{inst.name}.wav"))

render(mid_path, os.path.join(OUT, "bench_mix.wav"))
print("done:", [f"bench_{i.name}.wav" for i in pm.instruments])
