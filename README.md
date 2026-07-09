# songCopy

[Songsterr](https://www.songsterr.com/) 클론 + **AI 자동 채보**. 음악 파일을 넣으면 악기별 악보(탭+오선보)가 자동 생성되고, 브라우저에서 재생·연습·편집할 수 있습니다.

- **라이브 데모**: https://songcopy.vercel.app (읽기 전용 — 계정·채보는 로컬/컨테이너 배포에서 동작)
- **전체 기능 목록**: [docs/FEATURES.md](docs/FEATURES.md)

## 핵심 기능

- 🎼 **플레이어**: 오선보+탭 동시 렌더링(alphaTab), 신스 재생, 실시간 커서, 루프/속도/피치/메트로놈, 지판 뷰, 사이드바 믹서(트랙별 솔로/뮤트/볼륨/인쇄), 확대·축소, 세로 스크롤 ↔ 가로 페이지 넘김
- 🤖 **AI 채보 v2**: 음원 → 6스템 분리 → 악기별 채보 → 조표·큰보표·가사까지 완성된 악보. 비동기 잡 + 실시간 진행률. 상세는 아래 [AI 채보 스택](#ai-채보-스택)
- ✏️ **탭 에디터**: 아무 악기 노트 클릭 → 프렛 키패드/숫자키 입력, 실행취소(Ctrl+Z), 음길이·주법, 리비전 저장(위키 모델)
- 👤 **계정/커뮤니티**: 가입·로그인, 즐겨찾기 동기화, 리비전 히스토리·투표, 곡별 댓글, 내가 만든 곡 삭제
- 📄 **파일**: Guitar Pro/MusicXML 열기, MIDI/.gp 다운로드, 원본 오디오 백킹 트랙 + 싱크 조정

## 실행

```bash
# 1) API 서버 (포트 3001)
cd server
node --experimental-strip-types --no-warnings --watch src/index.ts   # node 22
# node 24+ 라면: npm run dev

# 2) 웹 (포트 5173, /api는 3001로 프록시)
cd web
npm install
npm run dev   # http://localhost:5173
```

### AI 채보 ML 환경 (선택 — 없으면 채보 기능만 비활성)

Python 3.12 전용 venv를 `server/ml/.venv`에 구성합니다:

```bash
brew install python@3.12 ffmpeg
python3.12 -m venv server/ml/.venv
server/ml/.venv/bin/pip install "audio-separator[cpu]" mt3-infer transkun \
  basic-pitch faster-whisper panns-inference "transformers==4.45.1" \
  pytorch_lightning "setuptools<81" pretty_midi requests
```

모델은 첫 실행 시 자동 다운로드됩니다 (YourMT3 체크포인트 → `server/.mt3_checkpoints/`,
분리 모델 → `server/ml/models/`, PANNs → `~/panns_data/` — wget이 없으면 curl로 수동:
[zenodo 3987831](https://zenodo.org/records/3987831)). 자세한 선정 근거는
[docs/ml-stack-research.md](docs/ml-stack-research.md).

## AI 채보 스택

| 단계 | 모델 | 라이선스(상업) |
|---|---|---|
| 음원 분리 (6스템) | **MVSep API** (BS Roformer SW, `MVSEP_API_KEY` 설정 시) / 로컬 BS-Roformer-SW (개발 전용) | API 출력물 상업 허용 / 로컬 가중치 불명 |
| 노트 채보 | **YourMT3+** (mt3-infer) | 가중치 Apache-2.0 |
| 피아노 | **Transkun** | MIT |
| 드럼 | **YourMT3+** 드럼 출력 | Apache-2.0 |
| 음색 판별 | **PANNs Cnn14** — 기타(어쿠스틱/일렉/디스토션), 신스 스템(스트링/오르간/브라스…) | CC BY 4.0 |
| 가사 | **faster-whisper** (VAD) | MIT |
| 폴백 | basic-pitch (ONNX) | Apache-2.0 |

파이프라인 출력은 조성 감지(조표+♭/♯ 표기), 피아노 왼손/오른손 큰보표, 가사 비트 정렬,
쉼표 병합까지 처리된 alphaTex로 변환됩니다. 라이선스 감사와 상업 전환 체크리스트는
[docs/licensing.md](docs/licensing.md).

## 배포

**상시 실행 Node 서버 + SQLite 파일 DB** 구조입니다. 프로덕션에서는 서버가 `web/dist`까지 서빙합니다.

```bash
# 방법 1: 로컬 머신 + Cloudflare 퀵 터널 (무료, ML 포함 풀기능)
cd web && npm run build
cloudflared tunnel --url http://localhost:3001   # → https://xxx.trycloudflare.com

# 방법 2: Docker (Railway/Fly/Render — ML 미포함 이미지)
docker build -t songcopy .
docker run -p 3001:3001 -v songcopy-data:/app/server/data songcopy

# 방법 3: Vercel 데모 (읽기 전용) — npx vercel deploy --prod
```

상업 서비스 시: `MVSEP_API_KEY` 환경변수 설정(분리 API 전환) + GPU 서버에서 채보 워커 실행 권장
(CPU 기준 3분 곡 ≈ 5분, GPU ≈ 40초).

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/songs?pattern=` | 곡 목록·검색 |
| GET/DELETE | `/api/songs/:slug` | 곡 메타 / 본인 곡 삭제 |
| POST | `/api/songs` | 빈 탭 생성 (로그인) |
| GET | `/api/songs/:slug/content` | 최신 리비전(GP7) 또는 원본 alphaTex |
| GET/POST/DELETE | `/api/songs/:slug/revisions` | 리비전 목록/게시/원본 복원 |
| GET/POST | `/api/songs/:slug/comments` | 곡별 댓글 |
| POST | `/api/transcribe` | AI 채보 잡 제출 → `202 {jobId}` (로그인) |
| GET | `/api/transcribe/jobs/:id` | 채보 진행률 폴링 (단계·%·결과 slug) |
| POST | `/api/revisions/:id/vote` | 리비전 정확도 투표 |
| POST | `/api/auth/signup·signin·signout` | 계정 |
| GET/PUT | `/api/favorites` | 즐겨찾기 동기화 |

## 문서

- **[기능 총람](docs/FEATURES.md)** — 모든 기능·단축키 한 문서 정리
- [ML 스택 리서치](docs/ml-stack-research.md) — 채보 모델 선정 근거 (2026 SOTA 비교)
- [라이선스 감사](docs/licensing.md) — 상업 SaaS 적합성 판정 + 전환 체크리스트
- [Songsterr 분석 시리즈](docs/songsterr-analysis.md) — [플레이어](docs/songsterr-player.md) · [기술](docs/songsterr-tech.md) · [콘텐츠](docs/songsterr-content.md) · [비즈니스](docs/songsterr-business.md)
- [기능 구현 현황](docs/feature-parity.md) — Songsterr 대비 구현/미구현
