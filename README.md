# songCopy

Songsterr(https://www.songsterr.com/) 클론 웹 프로젝트.

## 실행

터미널 두 개가 필요합니다:

```bash
# 0) AI 채보 기능을 쓰려면 (선택)
pip3 install --user basic-pitch

# 1) API 서버 (포트 3001)
cd server
npm run dev

# 2) 웹 (포트 5173, /api는 3001로 프록시)
cd web
npm install
npm run dev   # http://localhost:5173
```

## 스택

- **웹**: Vite + React + TypeScript
- **API 서버**: Node 24 내장 모듈만 사용 (`node:http` + `node:sqlite`, 의존성 0개). DB는 `server/data/songcopy.db`, 시드는 `web/src/data/songs.ts`를 그대로 임포트
- [alphaTab](https://alphatab.net/) — 탭 렌더링(SVG) + 신스 재생(SoundFont) + 커서 싱크
- 샘플 곡은 퍼블릭 도메인 곡의 자체 alphaTex 편곡 (`web/src/data/songs.ts`)

## 배포

이 앱은 **상시 실행 Node 서버 + SQLite 파일 DB** 구조라 컨테이너 호스팅(Railway, Fly.io, Render 등)에 적합합니다. 프로덕션에서는 서버가 `web/dist` 정적 파일까지 서빙하므로 컨테이너 하나로 끝납니다:

```bash
docker build -t songcopy .
docker run -p 3001:3001 -v songcopy-data:/app/server/data songcopy
# → http://localhost:3001
```

### Vercel 데모 (배포됨)

**https://songcopy.vercel.app** — `api/`의 서버리스 함수가 시드 곡을 읽기 전용으로 서빙하는 **데모 모드**입니다. 플레이어·에디터·지판 등 클라이언트 기능은 전부 동작하지만, Vercel 서버리스는 파일시스템이 휘발성이라 **계정·리비전 저장은 비활성화**되어 있습니다(시도 시 안내 메시지). 재배포: `npx vercel deploy --prod`.

전체 기능(DB 포함)을 배포하려면 위 Docker 방식(Railway/Fly/Render)을 쓰거나, DB를 Turso/Vercel Postgres로 교체해야 합니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/songs?pattern=` | 곡 목록·검색 |
| GET | `/api/songs/:slug` | 곡 메타 (리비전 수 포함) |
| GET | `/api/songs/:slug/content` | 최신 리비전(GP7 base64) 또는 원본 alphaTex |
| GET | `/api/songs/:slug/revisions` | 리비전 목록 |
| POST | `/api/songs/:slug/revisions` | 새 리비전 게시 (위키 모델: 누구나) |
| DELETE | `/api/songs/:slug/revisions` | 원본으로 되돌리기 |
| GET | `/api/revisions/:id/content` | 특정 리비전 열람 |

## 구현된 기능

- 홈: 곡 목록 + 검색
- 곡 페이지: 오선보+탭 렌더링, 섹션 라벨, 재생/일시정지, 실시간 커서·음표 하이라이트, 자동 스크롤
- 곡 헤더: 즐겨찾기(⭐, localStorage), 인쇄(alphaTab print)
- 내 타브(`/mytabs`): 즐겨찾기한 곡 목록
- 플레이어 바(Songsterr 배치): 트랙 전환, 원본/신디시스 토글(원본은 자리만), 솔로/뮤트, 속도(15~175% 슬라이더+프리셋), 루프(드래그 구간 선택), 메트로놈, 카운트인, 피치 시프트(±12, 오디오만), MIDI 다운로드, 더보기(한 줄에 4마디·강약 기호 토글), 편집기 자리
- 도움말 모달: 단축키 목록
- **Guitar Pro / MusicXML 파일 업로드**: 헤더 "새 타브" 또는 홈 하단 버튼 → 플레이어로 즉시 열기 (`.gp` `.gp3~5` `.gpx` `.musicxml` 등, 세션 메모리 보관)
- **다크 모드**: 더보기 > 설정에서 토글, 악보 렌더링 색상까지 반전 (localStorage 저장)
- **지판(Fretboard) 뷰**: 플레이어 바 "지판" 버튼(F) — 재생 중인 노트가 실시간으로 지판 위에 표시, 왼손잡이 모드 지원
- **원본 오디오 재생(백킹 트랙)**: 플레이어 바 "원본" 클릭 → 오디오 파일(mp3/ogg/wav) 업로드 → 악보와 동기 재생(V로 전환). 원본 모드에서는 Songsterr와 동일하게 솔로/뮤트/메트로놈/카운트인/피치 비활성
- **싱크 조정**: 원본 모드에서 "싱크" 버튼 — 오프셋(-10~+10초, 인트로 여백 보정)과 템포 배율(80~120%, 원곡-악보 템포 차 보정) 슬라이더. masterBar.syncPoints(Automation) + `api.updateSyncPoints()` 방식
- **탭 에디터(E)**: 노트 클릭 선택 → `0~9` 프렛 입력(두 자리 조합 지원, ≤24), `↑↓` 현 이동, `←→` 비트 이동, `Del` 삭제. 편집은 재생 오디오에도 반영
- **리비전 시스템(서버 저장, Songsterr 위키 모델)**: "리비전 저장" → GP7 직렬화해 서버 DB에 게시(**로그인 필요**, 작성자 기록). 곡 헤더의 수정 날짜 클릭 → **리비전 히스토리 드롭다운**(작성자·과거 리비전 열람), "원본으로 되돌리기". 홈 목록에 리비전 수 배지 표시
- **계정**: 가입/로그인(이메일+비밀번호, scrypt 해시 + 세션 쿠키). 로그인 시 **즐겨찾기 서버 동기화**(로컬과 합집합 병합)
- **에디터 도구**: 선택한 비트의 **음길이 변경**(2/4/8/16분), 노트 **주법 토글**(팜뮤트 P.M., 렛링, 비브라토, 데드 ×, 고스트)
- Songsterr 호환 단축키: `Space` `Backspace` `N` `C` `L` `S` `T` `M` `Alt+M` `R` `F` `V` `E` `Shift+1~8`

## 문서

- **[기능 총람](docs/FEATURES.md) — songCopy의 모든 기능 한 문서 정리 (단축키·믹서·에디터·리비전·계정 등)**
- [Songsterr 서비스 분석](docs/songsterr-analysis.md) — 기능·요금제·단축키·곡 페이지 UI 개요
- [웹 플레이어 심층 분석](docs/songsterr-player.md) — 프로덕션 JS 번들 역분석: 음성 제어, 원본/신스 오디오, 루프·속도·피치 상세, 상태 스키마, 검증판 단축키
- [기술 내부구조](docs/songsterr-tech.md) — API 엔드포인트, 데이터 포맷(Guitar Pro/JSON), 렌더링 스택, 클론용 오픈소스(alphaTab 등)
- [콘텐츠 제작 시스템](docs/songsterr-content.md) — 탭 에디터, 리비전, AI 채보, 저작권/라이선스
- [계정·앱·비즈니스](docs/songsterr-business.md) — 가입/결제, 모바일 앱, 회사 연혁, 경쟁사 비교