# Songsterr 기술 내부구조 및 클론용 오픈소스 생태계

> 검증일: 2026-07-08 · 표기: **확인됨** = 1차 소스(공식 저장소/robots.txt/API 응답) 또는 복수 소스 교차 확인 / **추정** = 단일 2차 소스·역공학·정황 근거

---

## 1. 공개/알려진 API 엔드포인트

### 1-1. 레거시 REST API (구버전, 일부 잔존) — **추정**
초기 Songsterr는 확장자 치환(`.xml` → `.json`/`.plist`) 방식의 공개 REST API를 제공했다. 여러 래퍼(Ruby `endel/songsterr-api`, Node `mmathys/node-songsterr`)가 이 구조를 기록한다.

| 용도 | URL 패턴 |
|---|---|
| 패턴(키워드) 검색 | `https://www.songsterr.com/a/ra/songs.json?pattern={query}` |
| 아티스트별 목록 | `https://www.songsterr.com/a/ra/songs/byartists.json?artists=metallica,led+zeppelin` |
| 최적 매치 조회 | `https://www.songsterr.com/a/wa/bestMatchForQueryStringPart?s={query}` |
| 리비전(구 XML) | `https://www.songsterr.com/a/ra/player/songrevision/{revisionId}.xml` |
| songId → 탭 리다이렉트 | `https://www.songsterr.com/a/wa/song?id={songId}` |

- 구 리비전 XML 응답은 `title`, `artist{id,name}`, `gp5`(CloudFront URL), `songId`, `tabId`, `revisionId`를 포함했다. **확인됨**(node-songsterr README 예시)
- 예: `{ title:'Canon In C', artist:{id:'12024',name:'Pachelbel'}, gp5:'http://d12drcwhcokzqv.cloudfront.net/18018423.gp5', songId:'90818', tabId:'163940', revisionId:'264243' }`

### 1-2. 현재(모던) 내부 API — **확인됨/추정 혼재**
최신 다운로더/싱크 프로젝트들이 역공학한 엔드포인트:

| 용도 | URL 패턴 | 근거 |
|---|---|---|
| 곡 카탈로그(전체 색인) | `https://www.songsterr.com/api/songs` (인증 불필요) | Apify 스크레이퍼 **확인됨** |
| 곡 메타/최신 리비전 | `https://www.songsterr.com/api/meta/{songId}` | 복수 2차 소스 **추정** |
| 영상 싱크 포인트 | `https://www.songsterr.com/api/video-points/{songId}/{revisionId}/list` | teaqu 프로젝트 **확인됨** |
| 트랙(파트) JSON | `https://{cdn}.cloudfront.net/part/{revisionId}/{partId}` | 역공학 **추정** |
| 코드(chords) | `https://chordpro{1-3}.songsterr.com/{songId}/{revisionId}/{hash}.chordpro` | 역공학 **추정** |

- `robots.txt`가 `/api/`, `/a/wo/`, `/a/ajax/`, `/a/wa/song`, `/cdn/audio4/` 등을 크롤 차단 — 내부 API·오디오 CDN 존재 방증. **확인됨**
- `/api/songs` 응답 필드(곡별): `songId`, `artistId`, `artistName`, `title`, 코드/플레이어 가용 여부(boolean), 트랙별 `{instrument, difficulty, views}`, 튜닝(MIDI 노트 배열), 총 조회수, 곡 페이지 URL. **확인됨**(Apify)
- 카탈로그 규모 약 60만 곡, 26개 병렬 쿼리 시드로 순회. **추정**

---

## 2. 탭 저장 포맷 & 데이터 모델

### 핵심 결론: 원본은 Guitar Pro, 웹은 트랙별 JSON — **확인됨**
- Songsterr는 **트랙(파트)당 1개의 JSON 파일**을 CloudFront CDN에 저장해 웹 플레이어에 제공한다. 원본 소스는 Guitar Pro 계열(`.gp5` 다운로드 URL이 CDN에 존재). **확인됨**
- 다운로더 도구들은 **웹 플레이어가 받는 JSON을 GP 파일로 역변환**한다(GP 원본을 직접 뜯는 게 아님). teaqu 프로젝트는 이 JSON을 Guitar Pro의 **GPIF XML**로 매핑 후 ZIP(`.gp7`) 패키징. **확인됨**

### JSON 데이터 모델 (역공학 종합) — **추정**
```
song
 ├─ revisionId          // 탭 버전 관리 키(최신 리비전 선택)
 └─ tracks[] (parts)
     ├─ partId / index  // 트랙 식별 (URL의 t0, t1…에 대응)
     ├─ name            // 악기명
     ├─ tuning[]        // 현별 MIDI 값 배열
     ├─ instrument      // 드럼: MIDI 채널 10 + neutral clef
     └─ measures[]
         └─ voices[]
             └─ beats[]
                 ├─ rhythm/duration
                 └─ notes[] { string, fret, velocity, effects: bend/slide/hammer-on/harmonic … }
```
- `revisionId`는 탭 버전을, `partId/index`는 개별 트랙을 식별. 노트/비트 **중복 제거(dedup)**로 파일 크기 최적화. **확인됨**(teaqu README)
- 자산 URL: GP 원본 `{cdn}.cloudfront.net/{id}.gp5`, 파트 JSON `.../part/{revisionId}/{partId}`, 코드 `chordpro*.songsterr.com/...chordpro`. **추정**

### 대표 다운로더/역공학 프로젝트
| 프로젝트 | 스택 | 특징 |
|---|---|---|
| `Metaphysics0/songsterr-downloader` | SvelteKit + TS + Bun, alphaTab | 페이지 state→트랙별 리비전 JSON→alphaTab score→`.gp7` export **확인됨** |
| `teaqu/guitar-pro-youtube-sync` | — | JSON→GPIF XML, video-points로 마디별 BPM 계산해 YouTube 싱크 GP 생성 **확인됨** |
| `ciospettw/PySongsterrDownlader` | Python | 네트워크 캡처로 CloudFront URL 확보, 트랙 JSON + PDF 생성 **확인됨** |
| `mmathys/node-songsterr` | Node | 구 XML 리비전 API 래퍼 **확인됨** |
| `djrobson5/SongsterrToGuitarPro`, `josipnigojevic/TabRiPP` | — | `.gp5` 저장, 드럼 MIDI 추출 **추정** |

---

## 3. 웹 플레이어 렌더링 & 프론트엔드 스택 — **확인됨(정황)**
Songsterr 공식 GitHub 조직(`github.com/songsterr`) 저장소가 강한 단서:
- **React + Flux + Bacon.js**(FRP) — `harukaze` 저장소 설명에 명시. **확인됨(조직 저장소)**
- **SVG 기반 표기 렌더링** — 조직에 `androidsvg`(SVG 렌더링 라이브러리) 존재, 커뮤니티에서도 SVG로 관측. Canvas가 아닌 **SVG 악보 렌더링**으로 추정. **추정**
- **dnd-kit**(React 드래그앤드롭) 사용 → 인터랙티브 탭 편집 UI. **확인됨(조직 저장소)**
- 역사적으로 초기엔 Adobe Flash 기반이었으나 HTML5로 전환. **확인됨**
- Next.js 사용 여부는 공개 증거 없음(라이브 페이지에서 `__NEXT_DATA__` 미확인). **미확인** — React SPA 계열로만 추정.

---

## 4. 오디오 / 싱크

### 4-1. 신스 재생 — **추정**
- 웹 플레이어는 브라우저 내 MIDI 신디사이저로 트랙을 재생(음소거/솔로 가능). 클론 관점에서 alphaTab의 alphaSynth(Web Audio API + SoundFont)와 동형. **추정**
- 조직 저장소에 `novocaine`(iOS/Mac 오디오), `opus-android`(Opus 코덱) → 모바일/오디오 스트리밍 인프라 보유. **확인됨(조직 저장소)**

### 4-2. 원곡/백킹 트랙 싱크 — **확인됨**
- "Backing track": 사용자 파트를 뮤트한 원곡 동기화 반주 제공. **확인됨**(Songsterr 공식 설명)
- 조직에 `MVSEP-MDX23`(음원 분리 모델) 존재 → 원곡에서 **스템 분리**로 백킹 트랙 생성 정황. **확인됨(조직 저장소)**
- **비트→시간 매핑 표현**: `api/video-points`가 **각 마디의 시작 시각(타임스탬프)** 을 제공. 연속 포인트 간 시간차 ÷ 마디 길이(박자표 기반)로 **마디별 BPM**을 산출 → 가변 템포 곡도 마디 단위 동기화. GP 변환 시 SyncPoint automation으로 주입. **확인됨**(teaqu)
- `android-youtube-player` 저장소 → YouTube 영상을 원곡 소스로 사용. **확인됨(조직 저장소)**

---

## 5. 클론에 쓸 오픈소스 라이브러리 비교

| 라이브러리 | 입력 포맷 | 탭 렌더링 | 재생/신스 | 커서 싱크 | 클론 적합도 |
|---|---|---|---|---|---|
| **alphaTab** (CoderLine) | GP3–7, GPX, MusicXML, alphaTex | SVG/Canvas, 기타 탭 네이티브 지원 | 내장 **alphaSynth**(SoundFont, Web Audio) | 내장 커서(bar/beat follow), 외부 오디오·영상 싱크 지원 | ★ **최적** — 렌더+재생+싱크 올인원 |
| **VexFlow** | JS API / VexTab(독자 포맷), MusicXML 미지원 | SVG/Canvas, 탭 가능 | 없음(렌더 전용) | 없음(직접 캔버스 오버레이로 구현) | 렌더만 필요 시 |
| **OSMD** (OpenSheetMusicDisplay) | MusicXML | VexFlow 기반, 표준 악보 중심 | 없음(별도 필요) | 커서 API 있음, 재생은 외부 | 표준 악보용, 탭엔 부적합 |
| **Tone.js** | — | 없음 | Web Audio 스케줄러/신스 | 타이밍 스케줄링 도구 | 오디오 엔진 보조 |
| **SoundFont**(sf2/sgm) + smplr/soundfont-player | — | 없음 | 악기 샘플 재생 | — | alphaSynth 대체 샘플 소스 |

**결론(추정)**: 기타 탭 렌더링 + 재생 + 커서 싱크를 한 번에 만족하는 것은 **alphaTab**뿐. 클론 코어 엔진으로 alphaTab을 두고, 원곡 싱크는 alphaTab의 external media sync + `video-points`류 마디-타임 매핑을 조합하는 구조가 정석.

---

## 6. 기존 오픈소스 Songsterr 유사 프로젝트

| 프로젝트 | 구현 내용 |
|---|---|
| **`louislam/its-mytabs`** | 가장 완성도 높은 **Songsterr 클론**. Deno 2.4 백엔드 + Vue/TS 프론트, alphaTab 엔진. GP(.gp/.gpx/.gp3-5)/MusicXML/CAPX 렌더, MIDI 신스(트랙 뮤트·솔로), 3종 커서 모드, MP3/OGG·YouTube 싱크(첫 마디 수동 싱크 후 자동 추종), 다크모드, 셀프호스팅(Docker). MIT. **확인됨** |
| `Metaphysics0/songsterr-downloader` | 탭→GP7 변환 웹앱(alphaTab). **확인됨** |
| `plean/songsterr-tab-exporter` | Songsterr 탭→인쇄용 PDF 크롬 확장(alphaTab 렌더). **확인됨** |
| `maxwellpark/ReactTabs`, `HetorusNL/react-songsterr` | React로 Songsterr API 탭 표시/임베드·동기화 데모. **확인됨** |
| `mmathys/songsterr-crawler`, Apify catalog scraper | 카탈로그 크롤링. **확인됨** |

클론 설계 참고 1순위는 **its-mytabs**(alphaTab 기반 전체 아키텍처가 그대로 참고 가능).

---

## 7. URL 구조 & 사이트맵 — **확인됨**
- **곡 페이지**: `https://www.songsterr.com/a/wsa/{artist}-{title}-tab-s{songId}`
  - 예: `.../metallica-master-of-puppets-tab-s455118`
  - 트랙 선택 시 `...-tab-s{songId}t{trackIndex}` (예: `t0`, `t1`) 형태로 확장. **추정**(node-songsterr 정규식 `s\d+t\d+`가 이를 뒷받침)
- **아티스트 페이지**: `.../a/wsa/{artist}-tabs-a{artistId}` (예: `backing-track-tabs-a77786`)
- **검색**: `https://www.songsterr.com/?pattern={query}` (구 API는 `/a/ra/songs.json?pattern=`)
- **사이트맵**: `https://www.songsterr.com/sitemap.xml` (robots.txt에 명시). **확인됨**
- **AI 정책**: `https://www.songsterr.com/ai.txt` 참조. **확인됨**
- robots.txt 차단: `/api/`, `/a/wo/`, `/a/ajax/`, `/a/wa/song`, `/store/`, `/cdn/audio4/`, `Revisions`/`FavoriteToggleAction` 등 액션 핸들러. **확인됨**

---

## 소스 URL 목록
- https://github.com/endel/songsterr-api (구 REST 래퍼)
- https://github.com/mmathys/node-songsterr (구 XML 엔드포인트·응답 예시)
- https://github.com/Metaphysics0/songsterr-downloader (모던 파이프라인·alphaTab GP7)
- https://github.com/teaqu/guitar-pro-youtube-sync (api/meta·video-points·GPIF 매핑·BPM 싱크)
- https://github.com/ciospettw/PySongsterrDownlader (CloudFront 캡처·트랙 JSON)
- https://github.com/louislam/its-mytabs (오픈소스 클론)
- https://github.com/plean/songsterr-tab-exporter (PDF 확장)
- https://github.com/songsterr (공식 조직: React+Flux+Bacon.js, androidsvg, dnd-kit, MVSEP, opus/novocaine)
- https://github.com/CoderLine/alphaTab / https://alphatab.net/docs/formats/guitar-pro-7
- https://github.com/vexflow/vexflow / https://www.vexflow.com/
- https://opensheetmusicdisplay.org/blog/sheet-music-display-libraries-browsers/
- https://apify.com/jungle_synthesizer/songsterr-tab-catalog-metadata-scraper (/api/songs 스키마)
- https://www.songsterr.com/robots.txt · https://www.songsterr.com/sitemap.xml
- https://www.songsterr.com/plus · https://www.songsterr.com/about (백킹 트랙 설명)
- https://publicapis.io/songsterr-music-api · https://toolstock.net/tool/songsterr/

### 한계/주의
- 모던 내부 API(`/api/meta`, `part/{revisionId}/{partId}`, `chordpro*`)의 정확한 CDN 도메인·응답 스키마는 **역공학 2차 소스 기반(추정)**. 실제 구현 전 브라우저 네트워크 탭으로 직접 캡처해 검증 필요.
- Next.js 사용 여부, SVG vs Canvas 최종 확정은 라이브 소스 직접 분석 필요(본 리서치는 조직 저장소 정황까지).
