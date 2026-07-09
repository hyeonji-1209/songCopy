# 상업 SaaS 라이선스 감사 (2026-07-09)

> 전제: 모델·코드를 **자체 서버에서 SaaS로 실행** (사용자에게 코드/가중치 배포 없음).
> alphaTab·폰트·사운드폰트는 브라우저로 전송되므로 "배포"로 별도 취급.
> GPL-3.0은 AGPL과 달리 네트워크 서비스 제공만으로는 소스공개 의무 없음
> ([GNU FAQ](https://www.gnu.org/licenses/gpl-faq.html#UnreleasedMods)).
> ⚠️ 법률 자문 아님. "학습 데이터 라이선스의 가중치 전이"(MAESTRO/MUSDB/AudioSet)는 법적 미확립 회색지대.

## 판정 요약

| 구성요소 | 코드 | 가중치 | 상업 SaaS |
|---|---|---|---|
| BS-Roformer-SW (분리) | MIT (audio-separator/MSST) | **불명** — 배포자도 `license: unknown`, 원 출처 소멸 | 🔴 **불가(권리 미확보)** |
| YourMT3 (채보) | GPL-3.0 | **Apache-2.0** (저자 명시, [Issue #12](https://github.com/mimbres/YourMT3/issues/12)) | 🟢 서버 구동 한정 안전 |
| ADTOF (드럼) | **CC BY-NC-SA 4.0** (리포 전체) | NC 승계 (원본 가중치 직접 변환) | 🔴 **불가 — NC는 SaaS도 위반** |
| Transkun (피아노) | MIT | 명목상 MIT (MAESTRO 유래 회색지대) | 🟡 조건부 — 저자 확인 권장 |
| faster-whisper + Whisper | MIT | **MIT 명문화** | 🟢 안전 |
| basic-pitch (폴백) | Apache-2.0 | 리포 번들 (Apache-2.0 해석) | 🟢 안전 |
| PANNs Cnn14 (음색) | MIT | **CC BY 4.0** ([Zenodo](https://zenodo.org/records/3987831)) | 🟢 안전 — 저작자 표시 필요 |
| alphaTab | MPL-2.0 | — | 🟢 안전 — 고지 필요, 소스 수정 시 그 파일만 공개 |
| sonivox.sf2 / Bravura | Apache-2.0 / SIL OFL 1.1 | — | 🟢 안전 — 고지 필요 |
| demucs/htdemucs (v1 폴백) | MIT | **연구 목적 한정** (저자 명시, [Issue #327](https://github.com/facebookresearch/demucs/issues/327)) | 🔴 **불가 — 대체재로도 못 씀** |
| MT3 원본/mt3-pytorch | Apache-2.0 / 없음 | 명시 라이선스 없음 | 🟡 불명 — YourMT3보다 못함 |

## 상업 전환 시 해야 할 일

1. **음원 분리 교체** — BS-Roformer-SW 자체 탑재 불가:
   - MVSep API 경유 (Terms §7이 출력물 상업 이용 허용) 또는
   - 상업 분리 API (LALAL.AI, AudioShake, Music.AI) 또는 원저작자 서면 허락
   - demucs는 가중치가 연구 한정이라 대체재 아님
2. **드럼 채보 교체** — ADTOF 제거 → **YourMT3의 드럼 출력** 사용 (멀티악기 지원, 가중치 Apache-2.0)
3. **오픈소스 고지 페이지** 추가: alphaTab(MPL-2.0+소스 링크), sonivox(Apache-2.0, Sonic Network Inc.),
   Bravura(OFL 1.1), PANNs(CC BY 4.0, Kong et al.), Whisper/faster-whisper(MIT), basic-pitch(Apache-2.0),
   YourMT3 가중치(Apache-2.0)
4. (선택) Transkun 저자에게 상업 사용 확인 메일 — 보수적으로 가려면 피아노도 basic-pitch로
5. YourMT3의 GPL **코드**를 클라이언트로 전송하거나 온프레미스 배포하지 말 것 (서버 전용 유지)

## 개인/포트폴리오 용도

현재 스택 전부 문제 없음. 위 목록은 유료 서비스 전환 시에만 해당.

## 상세 근거

각 항목의 라이선스 원문·이슈·모델카드 URL은 이 문서를 만든 조사 기록 참고:
- audio-separator LICENSE: <https://github.com/nomadkaraoke/python-audio-separator/blob/main/LICENSE>
- BS-ROFO-SW 모델카드(`license: unknown`): <https://huggingface.co/enerjazzer/BS-ROFO-SW-Fixed>
- MVSep Terms: <https://mvsep.com/en/terms>
- YourMT3 가중치 Apache-2.0: <https://github.com/mimbres/YourMT3/issues/12>, <https://huggingface.co/mimbres/YourMT3>
- ADTOF LICENSE(CC BY-NC-SA): <https://github.com/MZehren/ADTOF>, 데이터: <https://zenodo.org/records/10084511>
- Transkun MIT: <https://github.com/Yujia-Yan/Transkun>
- Whisper 가중치 MIT: <https://github.com/openai/whisper> (README/LICENSE)
- PANNs CC BY 4.0: <https://zenodo.org/records/3987831>
- demucs 가중치 연구 한정: <https://github.com/facebookresearch/demucs/issues/327>
- alphaTab MPL-2.0: <https://github.com/CoderLine/alphaTab/blob/develop/LICENSE>
- Bravura OFL: <https://github.com/steinbergmedia/bravura/blob/master/LICENSE.txt>
