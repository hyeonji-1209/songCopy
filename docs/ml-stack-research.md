# AI 채보 ML 스택 리서치 (2026-07)

> basic-pitch + htdemucs_6s + 수제 드럼 검출 파이프라인을 대체할 오픈소스 조사 결과 요약.
> 병렬 리서치 3건(채보 모델 / 분리·악기 인식 / 드럼·가사)의 결론.

## 최종 채택 스택

| 영역 | 기존 | 채택 | 근거 |
|---|---|---|---|
| 스템 분리 | demucs htdemucs_6s | **BS-Roformer-SW** (audio-separator로 구동) | 6스템(보컬/기타/피아노/베이스/other/드럼). guitar 9.05 / piano 7.83 dB SDR — htdemucs_6s의 기타↔피아노 혼동을 직접 해결. MVSep 리더보드 6스템 1위 |
| 노트 채보 | basic-pitch (2022) | **YourMT3+**(mt3-infer) — 범용, **Transkun** — 피아노 | 2025 AMT Challenge: basic-pitch F1 0.063 vs YourMT3+ 0.55~0.59 (약 9배). Transkun은 MAESTRO onset F1 0.984 |
| 드럼 채보 | 수제 밴드패스 온셋 분류 | **ADTOF-pytorch** | 실음원 359시간 학습 CRNN, 킥/스네어/햇/탐/심벌 5클래스 MIDI 직접 출력. torch만 필요 |
| 가사 | openai-whisper base | **faster-whisper**(medium+, VAD) → 추후 **whisperX**(단어 타임스탬프) | VAD로 간주 구간 환각 억제, 노래는 base 모델로는 부족 |
| 악기 라벨 교정 | 없음 | **PANNs** (panns-inference) | AudioSet 527클래스 — 'other' 스템의 신스/스트링 등 라벨 판별 |

공통 전제: **Python 3.12 venv** (`server/ml/.venv`) — audio-separator가 3.10+, 기존 시스템 python 3.9와 분리.

## 검토 후 제외한 것들

- **MT3 원본** (Google): JAX/T5X 의존성 부패, 설치 불가 수준
- **MVSEP-MDX23** (Songsterr가 쓰는 것): 4스템뿐(기타/피아노 없음), Roformer에 추월됨
- **Magenta OaF Drums**: TF1 시대 코드, Apple Silicon 설치 지옥
- **omnizart**: ARM Mac 비호환 명시
- **LarsNet** (드럼 킷 분리): 성능 좋으나 모델 CC BY-NC(비상업)
- **MIROS** (2025 AMT Challenge 우승): 코드 미공개 — 공개되면 재평가
- **Timbre-Trap/PerceiverTF**: 연구용, MIDI 출력 미정비

## 설치 요약

```bash
brew install python@3.12
python3.12 -m venv server/ml/.venv
server/ml/.venv/bin/pip install "audio-separator[cpu]" transkun panns-inference basic-pitch faster-whisper
git clone https://github.com/xavriley/ADTOF-pytorch server/ml/ADTOF-pytorch
server/ml/.venv/bin/pip install -e server/ml/ADTOF-pytorch
# YourMT3: pip install mt3-infer && mt3-infer download (체크포인트 ~2.8GB)
```

## 라이선스 주의

- ADTOF 원본 데이터/모델: CC BY-NC-SA 파생 가능성 — 상업 서비스 전 저자 확인 필요
- YourMT3 코드: GPL-3.0 (mt3-infer 래퍼는 MIT)
- ByteDance piano_transcription: LICENSE 파일 없음 → Transkun(MIT) 사용
- 개인 학습/포트폴리오 용도는 전부 문제 없음

## 검증 기록 (합성 정답 음원)

- ADTOF (드럼만, 정답 킥16/스네어16/햇64): 킥 15, 햇 57, 스네어 44(합성 노이즈 스네어가 실드럼 학습 모델에 불리 — 실곡에서는 우위 예상). 수제 로직(햇 32/64) 대비 개선
- BS-Roformer-SW: audio-separator 모델 목록에 `BS-Roformer-SW.ckpt`로 존재 확인

## 참고 링크

- audio-separator: https://github.com/nomadkaraoke/python-audio-separator
- BS-Roformer-SW: https://mvsep.com/algorithms/77
- MSST(만능 러너): https://github.com/ZFTurbo/Music-Source-Separation-Training
- mt3-infer: https://github.com/openmirlab/mt3-infer / YourMT3: https://github.com/mimbres/YourMT3
- Transkun: https://github.com/Yujia-Yan/Transkun
- ADTOF-pytorch: https://github.com/xavriley/ADTOF-pytorch
- MDX23C DrumSep ckpt: https://huggingface.co/Politrees/UVR_resources
- whisperX: https://github.com/m-bain/whisperX / faster-whisper: https://github.com/SYSTRAN/faster-whisper
- PANNs: https://github.com/qiuqiangkong/panns_inference
- 2025 AMT Challenge 결과: https://arxiv.org/html/2603.27528v1
