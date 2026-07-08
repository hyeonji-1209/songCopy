# Songsterr 웹 플레이어 심층 분석

> 조사일: 2026-07-08
> 조사 방법: 공식 도움말(/help)·Plus 안내(/plus) 페이지 분석 + **실제 배포 중인 프로덕션 JS 번들(appClient, common, ConstraintsModal, realtimeVoiceSession, PitchShift, Mixer, YTRequestAudioModal 등)과 탭 페이지에 내장된 Redux 상태 JSON을 직접 다운로드·역분석**. 코드에서 직접 확인한 항목은 신뢰도가 매우 높음.

---

## 1. "Voice" / 음성 버튼 (마이크 아이콘 + Plus 자물쇠)

**정체: 핸즈프리 음성 명령(Voice Control) 기능. — 확인됨 (번들 코드)**

- 가설 검증: ~~원곡 보컬 트랙~~ ❌, ~~보이스오버 강의~~ ❌, ~~노래방식 마이크 입력~~ ❌. **연습 중 손을 떼지 않고 말로 플레이어를 조종하는 기능**이 정답.
- 버튼 id `control-voice-practice`, 라벨 `Voice`, 툴팁: *"Control Tab hands-free while you practice."* — 확인됨
- **구현: 브라우저 `getUserMedia`로 마이크 캡처 → 서버 `/api/voice/realtime-session`에서 세션 발급 → `https://api.openai.com/v1/realtime/calls`로 WebRTC 연결 (OpenAI Realtime API + tool calling)** — 확인됨 (realtimeVoiceSession 청크)
- 지원 명령(코드의 tool 목록): `set_playback, loop_bar, loop_current, loop_off, loop_time, restart_loop, nav_bar, go_to_bar, go_to_section, go_to_time, set_tempo, tempo_slower/faster, metronome, count_in, count_in_between_loops, solo_current_track, mute_current_track, mute_sound, set_volume, switch_track, set_audio_source, pitch_shift, transpose_notation, scroll_page, show_track, run_commands, repeat` — 확인됨
- 공식 한국어 예시 문구(번들 내 번역): "재생, 일시정지, 이 마디 루프, 5번 마디 루프, 5–8번 마디 루프, 루프 끄기, 다음 마디, 12번 마디로 이동, 느리게, 빠르게, 속도 80%, 메트로놈 켜기/끄기, 카운트인 켜기/끄기, 이 트랙 솔로/음소거, 볼륨 50%, 베이스로 전환, 코러스로 이동, 원본 오디오, 신스 오디오, 피치 올리기/내리기, 조옮김 올리기/내리기, 1:20으로 이동, 1:20부터 1:35까지 루프, 다시" — 확인됨
- **Plus 전용** (`plus_voice` 잠금 배너) — 확인됨
- 각 명령 실행 시 토스트 피드백("Loop bars 5–8", "Speed 80%" 등), 음성 지정 템포는 15–175%로 클램프 — 확인됨
- 패널이 열려 있으면 사용 불가, 현재 `voice_control` A/B 실험으로 점진 배포 중 — 확인됨

## 2. 원본/신디시스 (Original/Synth) 오디오 토글

- UI: 오디오 소스 선택 팝업(id `control-source`). 옵션 = **원본(Original, YouTube 아이콘) / 신디시스(Synth) / Audio file(내 오디오 업로드) / Separated audio**. **단축키 V로 전환** — 확인됨 (코드)
- **원본 오디오의 실체 = 싱크 포인트(`videoPoints`)로 탭과 동기화된 YouTube 음원/영상** ("Play along with synced YouTube video") — 확인됨
- **무료 사용자 제한: 원본 오디오 재생 시 10마디마다 "동기화 일시 정지(sync pause)"** — 확인됨 (/plus + ConstraintsModal 코드)
  - 제한 도달 시 모달: "Upgrade to Plus" / "Synth로 전환" / "일시 정지 포함하여 계속" / **"Spend 10 bonus minutes"(기여자에게 주는 무료 Plus 분 차감)** — 확인됨
- **원본 오디오 없는 곡: "Request original audio" 버튼 → 요청하면 "usually within 15 minutes" 내 추가** — 확인됨 (YTRequestAudioModal)
- **오디오 타입 정의(코드 원문):**
  - **Backing track**: 원곡에서 현재 악기만 뮤트한 반주 — 확인됨
  - **Solo**: 원곡에서 해당 악기만 분리한 오디오 — 확인됨
  - **Playthrough**: 연주 영상. 비디오 feature = `playthrough / solo / backing` — 확인됨
- **원본 모드에서 M(뮤트)/Shift+M(솔로) = YouTube 원곡을 AI 스템 분리한 backing/solo 트랙을 요청·재생** — 확인됨
- 신디시스: 서버에서 고품질 오디오 렌더링("Ready in about 15 minutes", 렌더링 전엔 preview audio 재생), 30분 초과 곡은 고품질 오디오 미지원 — 확인됨

## 3. "코드 감지" (Detect chords) 메뉴

- ⋯ 메뉴 항목 id `control-detect-chords`. "Detect chords" ↔ "Hide detected chords" 토글 — 확인됨
- 기능: **"Detect and place chords based on the tab harmony" — 오디오 분석이 아니라 탭 악보의 화성을 분석해 코드 기호를 자동 표기** — 확인됨
- 상태에 `detectedChords.stagedChords / rejectedChords / publishedOverlayKey` → 감지된 코드를 수락/거부하고 게시(기여)하는 흐름 — 확인됨(상태 구조), 세부 UX는 추정
- 드럼 트랙 등 일부 비활성, `detect_chords` A/B 실험 중, Plus 잠금 없음(무료 추정) — 추정

## 4. "전조" (Transpose) 메뉴

- ⋯ 서브메뉴 id `control-transpose`, **단축키 K** — 확인됨
- 구성: "Transpose notation" 스테퍼 + "Reset transposition" + 화살표 키 지원 — 확인됨
- **범위: 전조 표기 ±36 반음(3옥타브), 피치 시프트 ±12, chords 페이지 조옮김 ±11** — 확인됨(코드)
- 악보 표기와 신스 재생음이 함께 이동(`transposeNotation` → 오디오 엔진 전달) — 확인됨. 원본 오디오에서는 표기만 — 추정
- **드럼 트랙 비활성** — 확인됨
- Plus 잠금 식별자 없음 → **무료 추정** — 추정

## 5. "설정" (Settings) 메뉴

⋯ 메뉴 하단 서브메뉴. 실제 구성(코드 추출) — 확인됨:
- **Appearance**: 테마(라이트/다크)
- **Language**: 로케일 선택
- **Tab**: "한 줄에 4마디 표시" / "멀티레스트 표시"(4마디·멀티트랙 시 비활성) / "강약 기호 표시" / "루프 사이 카운트인" 토글
- **Editor**(에디터 활성 시): 에디터 설정
- 별도 **지판(Fretboard) 설정** 팝업: "음이름 표시", "12프렛만", **"왼손잡이(Left-handed)"** — 확인됨 (왼손 모드는 지판 뷰 한정)

## 6. 메트로놈 · 카운트인

- 단축키: 메트로놈 N, 카운트인 C — 확인됨
- **메트로놈 팝업**: 볼륨 슬라이더(1–100, 기본 50) + **"클래식 메트로놈(똑딱)" vs "음성 카운팅(one-two)" 선택**. 일부 곡은 voice metronome 미지원 — 확인됨(코드)
- **원본 오디오 모드에서는 메트로놈·카운트인 모두 비활성** — 확인됨(공식 번역 문자열)
- 루프 반복 사이 카운트인 옵션(`isCountinBetweenLoops`) — 확인됨
- 카운트인 길이는 서버 생성 오디오의 `countIn.duration` 사용, 1마디 추정 — 추정
- Plus 잠금 없음 → 무료 — 추정

## 7. 루프 (Loop)

- **Plus 전용** (`plus_loop`) — 확인됨
- 단축키 L(온/오프), **Shift+→ / Shift+← 루프 오른쪽 경계 이동** — 확인됨 (/help)
- **드래그 가능한 루프 핸들**(`data-loop-handle`)로 A/B 경계 조정, **Alt+드래그 시 루프 전체 이동** — 확인됨(코드)
- 탭 위 포인터 드래그로 구간 선택 — 추정(코드 정황)
- 상태 모델: `cursor.position.{cursor, loopStart, loopEnd}` (틱 단위) — 확인됨
- 부가: "Restart loop", "Loop this bar", 음성 명령("5–8번 마디 루프", "1:20부터 1:35까지 루프") — 확인됨

## 8. 속도 조절 (Speed)

- **범위 15%–175%** (슬라이더 `aria-valuemin:15, aria-valuemax:175`) — 확인됨(코드). ~~25–200%~~ ❌
- 단축키: S(속도 패널), **Shift+1~8 = 15/25/50/75/100/125/150/175% 프리셋**, **Shift+A/D = BPM 1단위 미세 조정**, 슬라이더는 BPM 표시 — 확인됨(코드)
- **피치 유지**: "Adjust playback speed without changing pitch" — 확인됨
- **Plus 전용** (`plus_speed`) — 확인됨

## 9. 피치 시프트 (Pitch Shift)

- **범위 ±12 반음** — 확인됨(코드)
- 위치: 첫 마디 근처 튜닝 표시 옆 버튼, **단축키 R** — 확인됨
- **신스(및 업로드 오디오) 전용. 원본 오디오 미지원** ("To shift pitch, upload audio file of original recording or switch to synth audio") — 확인됨
- 용도: 악보 전조 없이 소리만 이동(변칙 튜닝 대응) — 확인됨
- **Plus 전용** (`plus_pitchshift`) — 확인됨

## 10. 솔로/뮤트 믹서

- **트랙별 볼륨 슬라이더 없음.** 상태는 `partsSolo[] / partsMute[] / partsToPlay[]` 배열 + **마스터 볼륨(`soundVolume`) 하나** — 확인됨(코드). 즉 **솔로/뮤트 토글 + 전체 볼륨** 구조
- 단축키: M = 현재 트랙 뮤트, Alt+M(Shift+M 표기도 존재) = 솔로 토글 — 확인됨
- 트랙 1개면 "솔로 모드는 영향을 주지 않습니다" 안내 — 확인됨
- **Plus 전용** (`plus_solo`, `plus_mute`, `plus_solo_mixer`, `plus_mute_mixer`) — 확인됨
- 원본 오디오 모드의 솔로/뮤트 = YouTube 스템 분리 트랙 요청 방식(§2) — 확인됨

## 11. 멀티트랙 · 트랙 전환 · 드럼/베이스

- 트랙 전환: 재생 버튼 옆 악기 버튼(믹서), 단축키 T — 확인됨
- **Track Autoswitch**: 클린↔디스토션 등 동일 기타 트랙 사이 자동 전환("AI track autoswitch") — 확인됨
- **멀티트랙 보기**: 믹서에서 "Add to multi-track" — 여러 트랙 동시 표시, 멀티트랙 sheet 모드에서 더블 스태프 지원 — 확인됨(코드)
- 곡 메타에 악기별 대표 트랙(`popularTrackGuitar/Bass/Drum/Vocals`), URL도 트랙별 분리 — 확인됨
- **드럼**: 전용 드럼 표기법 + "Open drum notation" 범례(DrumLegend) 패널. 구식 드럼 탭 표기는 폐지 — 확인됨
- 베이스: 4현 탭 + "Bass Backing Track" 타입 존재 — 확인됨

## 12. 커서/자동 스크롤 · 전체화면 · 왼손 모드 · 표기 옵션

- **녹색 재생 커서**가 비트 단위 진행 + 자동 스크롤. `userScrollOverride`(수동 스크롤 시 자동 스크롤 일시 해제), 루프 핸들 smooth 스크롤 — 확인됨(코드 필드), 세부 복귀 동작은 추정
- 더블클릭한 비트부터 재생("Play from beat"), Backspace 처음 이동, 방향키 커서 이동 — 확인됨
- 블루투스 이어폰 지연 문제는 공식적으로 유선 권장 — 확인됨 (/help)
- 재생 중 화면 꺼짐 방지(NoSleep.js) — 확인됨(번들)
- **전체화면 모드: 없음.** 대신 컨트롤 최소화(`controls.minimized`) + Plus 광고 제거 — 추정(부재 증명)
- **왼손 모드: 지판 뷰에만 존재.** 탭 좌우 반전 없음 — 확인됨(문자열 기준)
- **표기 옵션**: 탭(기본) / **Sheet Music 모드**(`notationMode: 'sheet'`) / **Lead Sheet 모드** / 별도 **Chords 페이지**(가사+코드, 자동 스크롤 속도 `chordsAutoscroll`, 카포 `chordsCapo`, 코드 단순화 `chordsSimplify`, 조옮김 ±11) — 확인됨(코드/상태)
- 코드 다이어그램 팝업(`chordDiagram`), 튜닝 표시, 다크/라이트 테마 — 확인됨

---

## 클론 설계 참고 요약

- **Plus 잠금 전체(코드 기준)**: speed, loop, solo, mute(+믹서), pitchshift, print, download, voice(음성 제어), autocomplete(AI), 원본 오디오 무중단 싱크
- **무료**: 탭 열람/재생, 트랙 전환, 메트로놈/카운트인, 전조(추정), 코드 감지(추정)
- **플레이어 상태 스키마 핵심**:
  ```
  player{ speed, pitchShift, transposeNotation, isCountin, isCountinBetweenLoops,
          isMetronome, metronomeType(regular|voice), metronomeVolume,
          partsSolo[], partsMute[], soundVolume, locks[],
          userAudioSelected, separatedAudioSelected }
  cursor.position{ cursor, loopStart, loopEnd }
  ```
- 사용자 오디오 업로드 → 서버 스템 분리(`separatedOggKeys`, `backingOggKeys`, `separationStatus`) 후 solo/backing 재생 — 확인됨(상태 구조)

## 단축키 최종 정리 (검증판)

| 키 | 동작 |
|---|---|
| `Space` | 재생/일시정지 |
| `Backspace` | 처음으로 |
| `←`/`→`, `↑`/`↓` | 커서/줄 이동 |
| `T` | 트랙 목록 |
| `S` | 속도 패널 |
| `Shift+1~8` | 속도 프리셋 15~175% |
| `Shift+A`/`Shift+D` | BPM ±1 |
| `L` | 루프 온/오프 |
| `Shift+→`/`Shift+←` | 루프 경계 이동 |
| `N` | 메트로놈 |
| `C` | 카운트인 |
| `M` | 현재 트랙 뮤트 |
| `Alt+M` | 솔로 |
| `V` | 오디오 소스 전환(원본/신스) |
| `R` | 피치 시프트 |
| `K` | 전조(Transpose) |
| `E` | 탭 에디터 |

## 소스 목록

1. https://www.songsterr.com/help — 단축키, 튜닝/피치, 코드·가사, 트랙 자동 전환, 블루투스 지연
2. https://www.songsterr.com/plus — Plus 기능 목록, 10마디 sync pause, 속도(피치 유지)
3. https://www.songsterr.com/a/wsa/metallica-nothing-else-matters-tab-s439171 — 페이지 내장 Redux 상태 JSON
4. https://static3.songsterr.com/production-main/static3/latest/appClient-CXWtwqM5uswolC9Q.js — 다국어 문자열(한국어 포함), 메뉴 구성
5. https://static3.songsterr.com/production-main/static3/latest/common-CBEeNmS-SF3oVcvW.js — 설정 메뉴, 속도 슬라이더, 전조/피치 범위, 메트로놈, 루프 핸들
6. https://static3.songsterr.com/production-main/static3/latest/realtimeVoiceSession-DJWEg6xysneVWesj.js — Voice Control(OpenAI Realtime + WebRTC)
7. https://static3.songsterr.com/production-main/static3/latest/ConstraintsModal-CJho9JXVwtbyfeEm.js — 무료 sync-pause 모달
8. https://static3.songsterr.com/production-main/static3/latest/PitchShift-BTFn6M5gM5_ECNcY.js — 피치 시프트 UI/제한
9. https://static3.songsterr.com/production-main/static3/latest/YTRequestAudioModal-Bxk9ECYPuB0w-xCs.js — backing/solo 타입 정의, 요청 플로우
10. https://static3.songsterr.com/production-main/static3/latest/Mixer-7FvBsIbKYBQkamRF.js — 믹서(멀티트랙, 볼륨 슬라이더 부재)
