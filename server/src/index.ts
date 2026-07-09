import http from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SONGS } from '../../web/src/data/songs.ts'

const PORT = Number(process.env.PORT ?? 3001)
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(join(DATA_DIR, 'songcopy.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    instruments TEXT NOT NULL,
    seed_date TEXT NOT NULL,
    tex TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    date TEXT NOT NULL,
    data BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    pass_salt TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id),
    slug TEXT NOT NULL,
    PRIMARY KEY (user_id, slug)
  );
`)
try {
  db.exec('ALTER TABLE revisions ADD COLUMN user_id INTEGER')
} catch {
  /* 이미 있음 */
}
try {
  db.exec("ALTER TABLE revisions ADD COLUMN source TEXT DEFAULT 'editor'")
} catch {
  /* 이미 있음 */
}
try {
  db.exec('ALTER TABLE songs ADD COLUMN source TEXT')
} catch {
  /* 이미 있음 */
}
try {
  db.exec('ALTER TABLE songs ADD COLUMN lyrics TEXT')
} catch {
  /* 이미 있음 */
}
db.exec(`
  CREATE TABLE IF NOT EXISTS revision_votes (
    revision_id INTEGER NOT NULL REFERENCES revisions(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    vote INTEGER NOT NULL,
    PRIMARY KEY (revision_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    date TEXT NOT NULL
  );
`)

// 시드: web/src/data/songs.ts 가 단일 소스. 편곡이 갱신되면 기존 행도 업데이트(업서트).
const insertSong = db.prepare(
  `INSERT INTO songs (slug, title, artist, instruments, seed_date, tex) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(slug) DO UPDATE SET
     title = excluded.title, artist = excluded.artist,
     instruments = excluded.instruments, tex = excluded.tex`,
)
for (const s of SONGS) {
  insertSong.run(s.slug, s.title, s.artist, JSON.stringify(s.instruments), s.revisionDate, s.tex)
}

interface SongRow {
  id: number
  slug: string
  title: string
  artist: string
  instruments: string
  seed_date: string
  tex: string
  source?: string | null
}

const qList = db.prepare('SELECT * FROM songs ORDER BY title')
const qBySlug = db.prepare('SELECT * FROM songs WHERE slug = ?')
const qRevisions = db.prepare(
  `SELECT r.id, r.date, r.source, u.name AS author,
          COALESCE((SELECT SUM(v.vote) FROM revision_votes v WHERE v.revision_id = r.id), 0) AS score
   FROM revisions r
   LEFT JOIN users u ON u.id = r.user_id WHERE r.song_id = ? ORDER BY r.id DESC`,
)
const qMyVote = db.prepare('SELECT vote FROM revision_votes WHERE revision_id = ? AND user_id = ?')
const qUpsertVote = db.prepare(
  `INSERT INTO revision_votes (revision_id, user_id, vote) VALUES (?, ?, ?)
   ON CONFLICT(revision_id, user_id) DO UPDATE SET vote = excluded.vote`,
)
const qDelVote = db.prepare('DELETE FROM revision_votes WHERE revision_id = ? AND user_id = ?')
const qComments = db.prepare(
  `SELECT c.id, c.text, c.date, c.user_id, u.name AS author FROM comments c
   LEFT JOIN users u ON u.id = c.user_id WHERE c.song_id = ? ORDER BY c.id DESC`,
)
const qAddComment = db.prepare(
  'INSERT INTO comments (song_id, user_id, text, date) VALUES (?, ?, ?, ?)',
)
const qCommentById = db.prepare('SELECT * FROM comments WHERE id = ?')
const qDelComment = db.prepare('DELETE FROM comments WHERE id = ?')
const qLatestRev = db.prepare('SELECT * FROM revisions WHERE song_id = ? ORDER BY id DESC LIMIT 1')
const qRevById = db.prepare('SELECT * FROM revisions WHERE id = ?')
const qAddRev = db.prepare('INSERT INTO revisions (song_id, date, data, user_id) VALUES (?, ?, ?, ?)')
const qClearRevs = db.prepare('DELETE FROM revisions WHERE song_id = ?')

const qUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?')
const qUserById = db.prepare('SELECT id, name, email FROM users WHERE id = ?')
const qAddUser = db.prepare(
  'INSERT INTO users (name, email, pass_salt, pass_hash, created) VALUES (?, ?, ?, ?, ?)',
)
const qAddSession = db.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)')
const qSession = db.prepare('SELECT user_id FROM sessions WHERE token = ?')
const qDelSession = db.prepare('DELETE FROM sessions WHERE token = ?')
const qFavs = db.prepare('SELECT slug FROM favorites WHERE user_id = ?')
const qAddFav = db.prepare('INSERT OR IGNORE INTO favorites (user_id, slug) VALUES (?, ?)')
const qClearFavs = db.prepare('DELETE FROM favorites WHERE user_id = ?')

interface UserRow {
  id: number
  name: string
  email: string
  pass_salt: string
  pass_hash: string
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function getSessionToken(req: http.IncomingMessage): string | null {
  const cookie = req.headers.cookie ?? ''
  const m = cookie.match(/(?:^|;\s*)sc_session=([^;]+)/)
  return m ? m[1] : null
}

function currentUser(req: http.IncomingMessage): { id: number; name: string; email: string } | null {
  const token = getSessionToken(req)
  if (!token) return null
  const s = qSession.get(token) as { user_id: number } | undefined
  if (!s) return null
  return (qUserById.get(s.user_id) as { id: number; name: string; email: string } | undefined) ?? null
}

function sessionCookie(token: string, clear = false): string {
  return `sc_session=${clear ? '' : token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${clear ? 0 : 60 * 60 * 24 * 30}`
}

function songMeta(row: SongRow) {
  const revs = qRevisions.all(row.id) as { id: number; date: string }[]
  return {
    slug: row.slug,
    title: row.title,
    artist: row.artist,
    instruments: JSON.parse(row.instruments) as string[],
    seedDate: row.seed_date,
    source: row.source ?? null,
    lyrics: (row as { lyrics?: string | null }).lyrics ?? null,
    latestRevision: revs[0] ?? null,
    revisionCount: revs.length,
  }
}

function uniqueSlug(title: string, artist: string): string {
  const base =
    `${artist}-${title}`
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'song'
  let slug = base
  for (let n = 2; qBySlug.get(slug); n++) slug = `${base}-${n}`
  return slug
}

// ── AI 채보: 노트 이벤트 → alphaTex 변환 ──
interface NoteEvent {
  start: number
  end: number
  midi: number
  /** 비트 정렬 양자화 슬롯 (16분음표 단위) — 스크립트가 부여 */
  qs?: number
  qd?: number
}

const GUITAR_TUNING = [64, 59, 55, 50, 45, 40] // alphaTex string 1(高)~6(低)
const BASS_TUNING = [43, 38, 33, 28] // g2 d2 a1 e1

// 16분음표 그리드: 빠른 프레이즈·잔음까지 보존
const SLOTS_PER_BAR = 16
const MAX_BARS = 128
const DUR: Record<number, string> = { 1: ':16', 2: ':8', 4: ':4', 8: ':2', 16: ':1' }
const fitDur = (avail: number) =>
  avail >= 16 ? 16 : avail >= 8 ? 8 : avail >= 4 ? 4 : avail >= 2 ? 2 : 1

const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
const pitchName = (midi: number) => `${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

/** 노트 이벤트 → 마디별 alphaTex 토큰.
 * tuning 지정 시 프렛 매핑(탭), null이면 음이름(피아노/신스 등 오선보 전용) */
function notesToBars(
  notes: NoteEvent[],
  bpm: number,
  tuning: number[] | null,
  beatSlots?: number[], // 비쉼표 비트가 놓인 슬롯 목록 수집 (가사 정렬용)
): string[] | null {
  const grid = 15 / bpm // 16분음표(초)
  const lowest = tuning ? tuning[tuning.length - 1] : 36
  const highest = tuning ? tuning[0] + 20 : 96
  const bySlot = new Map<number, { midi: number; durSlots: number }[]>()
  for (const n of notes) {
    // 비트 정렬 슬롯이 있으면 우선 사용 (템포 드리프트 보정됨)
    const slot = n.qs ?? Math.round(n.start / grid)
    if (slot >= MAX_BARS * SLOTS_PER_BAR) continue
    const durSlots = Math.max(
      1,
      Math.min(SLOTS_PER_BAR, n.qd ?? Math.round((n.end - n.start) / grid)),
    )
    let midi = n.midi
    while (midi < lowest) midi += 12
    while (midi > highest) midi -= 12
    if (!bySlot.has(slot)) bySlot.set(slot, [])
    bySlot.get(slot)!.push({ midi, durSlots })
  }
  if (bySlot.size === 0) return null

  const slots = [...bySlot.keys()].sort((a, b) => a - b)
  const totalBars = Math.min(MAX_BARS, Math.ceil((slots[slots.length - 1] + 1) / SLOTS_PER_BAR))

  let prevFret = 0
  const mapNote = (midi: number, used: Set<number>): string | null => {
    if (!tuning) {
      if (used.has(midi)) return null // 코드 내 중복 음 제거
      used.add(midi)
      return pitchName(midi)
    }
    let best: { fret: number; string: number } | null = null
    for (let s = 0; s < tuning.length; s++) {
      const stringNo = s + 1
      if (used.has(stringNo)) continue
      const fret = midi - tuning[s]
      if (fret < 0 || fret > 20) continue
      if (!best || Math.abs(fret - prevFret) + fret * 0.3 < Math.abs(best.fret - prevFret) + best.fret * 0.3) {
        best = { fret, string: stringNo }
      }
    }
    if (!best) return null
    used.add(best.string)
    prevFret = best.fret
    return `${best.fret}.${best.string}`
  }

  const bars: string[] = []
  let cursor = 0
  for (let bar = 0; bar < totalBars; bar++) {
    const barEnd = (bar + 1) * SLOTS_PER_BAR
    const tokens: string[] = []
    while (cursor < barEnd) {
      const events = bySlot.get(cursor)
      const nextEventSlot = slots.find((s) => s > cursor) ?? Infinity
      if (events && events.length > 0) {
        const wanted = Math.max(...events.map((e) => e.durSlots))
        const dur = fitDur(Math.min(wanted, nextEventSlot - cursor, barEnd - cursor))
        const used = new Set<number>()
        const mapped = events.map((e) => mapNote(e.midi, used)).filter(Boolean) as string[]
        if (mapped.length === 0) tokens.push(`${DUR[dur]} r`)
        else if (mapped.length === 1) tokens.push(`${DUR[dur]} ${mapped[0]}`)
        else tokens.push(`${DUR[dur]} (${mapped.join(' ')})`)
        if (mapped.length > 0) beatSlots?.push(cursor)
        cursor += dur
      } else {
        const dur = fitDur(Math.min(nextEventSlot, barEnd) - cursor)
        tokens.push(`${DUR[dur]} r`)
        cursor += dur
      }
    }
    bars.push(tokens.join(' '))
  }
  return bars
}

interface DrumEvent {
  time?: number
  slot?: number
  kind: 'kick' | 'snare' | 'hat' | 'tom' | 'cymbal'
}

/** 드럼 온셋 → 16분음표 그리드 퍼커션 토큰 */
function drumsToBars(events: DrumEvent[], bpm: number): string[] | null {
  const grid = 15 / bpm
  const ART: Record<DrumEvent['kind'], string> = {
    kick: 'KickHit',
    snare: 'SnareHit',
    hat: 'HiHatClosed',
    tom: 'MidTomHit',
    cymbal: 'CrashMediumHit',
  }
  const bySlot = new Map<number, Set<string>>()
  let lastSlot = 0
  for (const e of events) {
    const slot = e.slot ?? Math.round((e.time ?? 0) / grid)
    if (slot >= MAX_BARS * SLOTS_PER_BAR) continue
    if (!bySlot.has(slot)) bySlot.set(slot, new Set())
    bySlot.get(slot)!.add(ART[e.kind])
    lastSlot = Math.max(lastSlot, slot)
  }
  if (bySlot.size < 4) return null
  const totalBars = Math.min(MAX_BARS, Math.ceil((lastSlot + 1) / SLOTS_PER_BAR))
  const bars: string[] = []
  for (let bar = 0; bar < totalBars; bar++) {
    const tokens: string[] = []
    for (let s = bar * SLOTS_PER_BAR; s < (bar + 1) * SLOTS_PER_BAR; s++) {
      const hits = bySlot.get(s)
      if (!hits || hits.size === 0) tokens.push(':16 r')
      else if (hits.size === 1) tokens.push(`:16 ${[...hits][0]}`)
      else tokens.push(`:16 (${[...hits].join(' ')})`)
    }
    bars.push(tokens.join(' '))
  }
  return bars
}

interface TranscribeTracks {
  vocals?: NoteEvent[]
  guitar?: NoteEvent[]
  piano?: NoteEvent[]
  other?: NoteEvent[]
  bass?: NoteEvent[]
  drums?: DrumEvent[]
}

/** Whisper 가사([m:ss] 줄)를 보컬 비트 위치에 맞춰 alphaTex \lyrics 한 줄로.
 * `_` 청크는 alphaTab이 빈 칸으로 렌더 — 가사 없는 비트를 건너뛰는 필러. */
function lyricsToTexLine(lyrics: string, bpm: number, beatSlots: number[]): string | null {
  const segs: { slot: number; words: string[] }[] = []
  for (const line of lyrics.split('\n')) {
    const m = /^\[(\d+):(\d{2})\]\s*(.+)$/.exec(line.trim())
    if (!m) continue
    const sec = Number(m[1]) * 60 + Number(m[2])
    // ", [, ], + 는 alphaTex/가사 문법과 충돌 — 제거
    const words = m[3].replace(/["[\]+\\]/g, '').split(/\s+/).filter(Boolean)
    if (words.length) segs.push({ slot: Math.round((sec * bpm) / 15), words })
  }
  if (segs.length === 0 || beatSlots.length === 0) return null
  const chunks: string[] = new Array(beatSlots.length).fill('_')
  let bi = 0
  for (const seg of segs) {
    while (bi < beatSlots.length && beatSlots[bi] < seg.slot) bi++
    for (const w of seg.words) {
      if (bi >= beatSlots.length) break
      chunks[bi++] = w
    }
  }
  let end = chunks.length
  while (end > 0 && chunks[end - 1] === '_') end--
  if (end === 0) return null
  return chunks.slice(0, end).join(' ')
}

// 감지된 악기만 트랙으로 생성 (6스템: vocals/guitar/piano/other/bass/drums)
function tracksToAlphaTex(
  tracks: TranscribeTracks,
  bpm: number,
  title: string,
  artist: string,
  lyrics?: string,
): string {
  const parts: string[] = []
  const add = (
    notes: NoteEvent[] | undefined,
    build: (bars: string[]) => string,
    tuning: number[] | null,
  ) => {
    if (!notes || notes.length < 8) return
    const bars = notesToBars(notes, bpm, tuning)
    if (bars) parts.push(build(bars))
  }

  // 보컬: 가사가 있으면 음표 아래에 타임스탬프 맞춰 배치
  if (tracks.vocals && tracks.vocals.length >= 8) {
    const beatSlots: number[] = []
    const bars = notesToBars(tracks.vocals, bpm, GUITAR_TUNING, beatSlots)
    if (bars) {
      const lyr = lyrics ? lyricsToTexLine(lyrics, bpm, beatSlots) : null
      parts.push(
        `\\track "멜로디 (보컬)"\n\\staff {score tabs}\n${lyr ? `\\lyrics 0 "${lyr}"\n` : ''}${bars.join(' |\n')}`,
      )
    }
  }
  add(tracks.guitar, (b) => `\\track "기타"\n\\staff {score tabs}\n\\instrument 25\n${b.join(' |\n')}`, GUITAR_TUNING)
  // 피아노는 큰보표: 가운데 도(C4) 기준 오른손(높은음자리)/왼손(낮은음자리) 2단.
  // 한 손 분량이 사실상 없으면 기존처럼 단일 단으로.
  if (tracks.piano && tracks.piano.length >= 8) {
    const rh = tracks.piano.filter((n) => n.midi >= 60)
    const lh = tracks.piano.filter((n) => n.midi < 60)
    const rhBars = rh.length >= 4 ? notesToBars(rh, bpm, null) : null
    const lhBars = lh.length >= 4 ? notesToBars(lh, bpm, null) : null
    if (rhBars && lhBars) {
      const len = Math.max(rhBars.length, lhBars.length)
      while (rhBars.length < len) rhBars.push(':1 r')
      while (lhBars.length < len) lhBars.push(':1 r')
      parts.push(
        `\\track "키보드 (피아노)"\n\\staff {score}\n\\instrument 0\n${rhBars.join(' |\n')} |\n\\staff {score}\n\\clef F4\n${lhBars.join(' |\n')}`,
      )
    } else {
      add(tracks.piano, (b) => `\\track "키보드 (피아노)"\n\\staff {score}\n\\instrument 0\n${b.join(' |\n')}`, null)
    }
  }
  add(tracks.other, (b) => `\\track "신스/기타 악기"\n\\staff {score}\n\\instrument 81\n${b.join(' |\n')}`, null)
  add(tracks.bass, (b) => `\\track "베이스"\n\\staff {tabs}\n\\instrument 33\n\\tuning g2 d2 a1 e1\n${b.join(' |\n')}`, BASS_TUNING)

  const drums = tracks.drums ? drumsToBars(tracks.drums, bpm) : null
  if (drums) {
    parts.push(`\\track "드럼"\n\\instrument percussion\n\\articulation defaults\n${drums.join(' |\n')}`)
  }
  if (parts.length === 0) throw new Error('no notes detected')

  const esc = (s: string) => s.replace(/"/g, '\\"')
  return `\\title "${esc(title)}"
\\subtitle "${esc(artist)}"
\\tempo ${bpm}
.
${parts.join('\n')}`
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  })
  res.end(payload)
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

const WEB_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {})

    // ── 인증 ──
    if (path === '/api/auth/signup' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as {
        name?: string
        email?: string
        password?: string
      }
      const name = body.name?.trim()
      const email = body.email?.trim().toLowerCase()
      if (!name || !email || !body.password || body.password.length < 4) {
        return json(res, 400, { error: '이름, 이메일, 비밀번호(4자 이상)가 필요합니다' })
      }
      if (qUserByEmail.get(email)) return json(res, 409, { error: '이미 가입된 이메일입니다' })
      const salt = randomBytes(16).toString('hex')
      const r = qAddUser.run(name, email, salt, hashPassword(body.password, salt), new Date().toISOString())
      const token = randomUUID()
      qAddSession.run(token, Number(r.lastInsertRowid), new Date().toISOString())
      return json(res, 201, { name, email }, { 'Set-Cookie': sessionCookie(token) })
    }

    if (path === '/api/auth/signin' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as { email?: string; password?: string }
      const user = qUserByEmail.get(body.email?.trim().toLowerCase() ?? '') as UserRow | undefined
      if (!user || !body.password) return json(res, 401, { error: '이메일 또는 비밀번호가 틀립니다' })
      const hash = Buffer.from(hashPassword(body.password, user.pass_salt), 'hex')
      const stored = Buffer.from(user.pass_hash, 'hex')
      if (hash.length !== stored.length || !timingSafeEqual(hash, stored)) {
        return json(res, 401, { error: '이메일 또는 비밀번호가 틀립니다' })
      }
      const token = randomUUID()
      qAddSession.run(token, user.id, new Date().toISOString())
      return json(res, 200, { name: user.name, email: user.email }, { 'Set-Cookie': sessionCookie(token) })
    }

    if (path === '/api/auth/signout' && req.method === 'POST') {
      const token = getSessionToken(req)
      if (token) qDelSession.run(token)
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', true) })
    }

    if (path === '/api/auth/me' && req.method === 'GET') {
      const user = currentUser(req)
      return json(res, 200, user ? { name: user.name, email: user.email } : null)
    }

    // ── 즐겨찾기 동기화 (로그인 필요) ──
    if (path === '/api/favorites') {
      const user = currentUser(req)
      if (!user) return json(res, 401, { error: 'sign in required' })
      if (req.method === 'GET') {
        return json(res, 200, (qFavs.all(user.id) as { slug: string }[]).map((f) => f.slug))
      }
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as { slugs?: string[] }
        qClearFavs.run(user.id)
        for (const slug of body.slugs ?? []) qAddFav.run(user.id, String(slug))
        return json(res, 200, { ok: true })
      }
    }

    // POST /api/songs — 빈 탭 생성 (로그인 필요)
    if (req.method === 'POST' && path === '/api/songs') {
      const user = currentUser(req)
      if (!user) return json(res, 401, { error: 'sign in required' })
      const body = JSON.parse(await readBody(req)) as { title?: string; artist?: string }
      const title = body.title?.trim()
      const artist = body.artist?.trim() || 'Unknown'
      if (!title) return json(res, 400, { error: '제목이 필요합니다' })

      const slug = uniqueSlug(title, artist)
      const esc = (s: string) => s.replace(/"/g, '\\"')
      const tex = `\\title "${esc(title)}"
\\subtitle "${esc(artist)}"
\\tempo 120
.
\\track "기타"
\\staff {score tabs}
:1 r | r | r | r | r | r | r | r`
      insertSong.run(slug, title, artist, JSON.stringify(['기타']), new Date().toISOString(), tex)
      return json(res, 201, { slug })
    }

    // POST /api/transcribe — AI 채보: 오디오 → 탭 (로그인 필요)
    if (req.method === 'POST' && path === '/api/transcribe') {
      const user = currentUser(req)
      if (!user) return json(res, 401, { error: 'sign in required' })
      const body = JSON.parse(await readBody(req)) as {
        b64?: string
        title?: string
        artist?: string
        bpm?: number
        ext?: string
        sensitivity?: string
      }
      const sensitivity = ['precise', 'standard', 'dense'].includes(body.sensitivity ?? '')
        ? body.sensitivity!
        : 'standard'
      const title = body.title?.trim()
      if (!title || !body.b64) return json(res, 400, { error: '제목과 오디오 파일이 필요합니다' })
      const audio = Buffer.from(body.b64, 'base64')
      if (audio.length > 15_000_000) return json(res, 413, { error: '오디오는 15MB 이하만 가능합니다' })
      const ext = /^[a-z0-9]{1,5}$/.test(body.ext ?? '') ? body.ext : 'wav'

      const tmp = join(DATA_DIR, `transcribe-${randomUUID()}.${ext}`)
      writeFileSync(tmp, audio)
      try {
        // v2(SOTA 스택: BS-Roformer-SW + YourMT3 + ADTOF) 우선, ML venv 없으면 v1 폴백
        const base = join(dirname(fileURLToPath(import.meta.url)), '..')
        const mlPython = join(base, 'ml', '.venv', 'bin', 'python')
        const useV2 = existsSync(mlPython)
        const python = useV2 ? mlPython : 'python3'
        const script = join(base, 'scripts', useV2 ? 'transcribe_v2.py' : 'transcribe.py')
        // 비동기 spawn: 채보(수 분)가 도는 동안에도 서버가 다른 요청을 처리할 수 있어야 한다
        const proc = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
          (resolve) => {
            const p = spawn(python, [script, tmp, sensitivity])
            let stdout = ''
            let stderr = ''
            p.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
            p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
            const timer = setTimeout(() => p.kill('SIGKILL'), 600_000)
            p.on('close', (code) => {
              clearTimeout(timer)
              resolve({ status: code, stdout, stderr })
            })
            p.on('error', () => {
              clearTimeout(timer)
              resolve({ status: -1, stdout, stderr: stderr || 'spawn failed' })
            })
          },
        )
        if (proc.status !== 0) {
          console.error('transcribe failed:', proc.stderr?.slice(0, 500))
          return json(res, 500, { error: 'AI 채보 실행 실패 (basic-pitch/demucs 설치 확인)' })
        }
        const result = JSON.parse(proc.stdout) as {
          tracks?: TranscribeTracks
          bpm?: number | null
          lyrics?: string
          error?: string
        }
        const tracks = result.tracks ?? {}
        const totalNotes =
          (tracks.vocals?.length ?? 0) +
          (tracks.guitar?.length ?? 0) +
          (tracks.piano?.length ?? 0) +
          (tracks.other?.length ?? 0) +
          (tracks.bass?.length ?? 0)
        if (result.error || (totalNotes === 0 && !(tracks.drums?.length ?? 0))) {
          return json(res, 422, { error: '오디오에서 노트를 감지하지 못했습니다' })
        }
        // BPM: 사용자 입력 > 자동 감지 > 120
        const rawBpm = body.bpm && body.bpm > 0 ? body.bpm : (result.bpm ?? 120)
        const bpm = Math.min(220, Math.max(40, Math.round(rawBpm)))
        const artist = body.artist?.trim() || 'AI 채보'
        const tex = tracksToAlphaTex(tracks, bpm, title, artist, result.lyrics)
        const instruments = [
          ...(tracks.vocals?.length ? ['보컬'] : []),
          ...(tracks.guitar?.length ? ['기타'] : []),
          ...(tracks.piano?.length ? ['키보드'] : []),
          ...(tracks.other?.length ? ['신스'] : []),
          ...(tracks.bass?.length ? ['베이스'] : []),
          ...(tracks.drums?.length ? ['드럼'] : []),
        ]
        const slug = uniqueSlug(title, artist)
        insertSong.run(
          slug,
          title,
          artist,
          JSON.stringify(instruments.length ? instruments : ['기타']),
          new Date().toISOString(),
          tex,
        )
        db.prepare('UPDATE songs SET source = ?, lyrics = ? WHERE slug = ?').run(
          'ai',
          result.lyrics?.trim() || null,
          slug,
        )
        return json(res, 201, { slug, noteCount: totalNotes, bpm, hasLyrics: !!result.lyrics?.trim() })
      } finally {
        try {
          unlinkSync(tmp)
        } catch {
          /* 무시 */
        }
      }
    }

    // GET /api/songs?pattern=
    if (req.method === 'GET' && path === '/api/songs') {
      const pattern = (url.searchParams.get('pattern') ?? '').trim().toLowerCase()
      let rows = qList.all() as SongRow[]
      if (pattern) {
        rows = rows.filter(
          (r) =>
            r.title.toLowerCase().includes(pattern) || r.artist.toLowerCase().includes(pattern),
        )
      }
      return json(res, 200, rows.map(songMeta))
    }

    // /api/songs/:slug[/...]
    const m = path.match(/^\/api\/songs\/([^/]+)(?:\/(content|revisions|comments))?$/)
    if (m) {
      const row = qBySlug.get(decodeURIComponent(m[1])) as SongRow | undefined
      if (!row) return json(res, 404, { error: 'song not found' })

      if (req.method === 'GET' && !m[2]) return json(res, 200, songMeta(row))

      // 최신 리비전이 있으면 GP7, 없으면 원본 alphaTex
      if (req.method === 'GET' && m[2] === 'content') {
        const rev = qLatestRev.get(row.id) as { id: number; date: string; data: Uint8Array } | undefined
        if (rev) {
          return json(res, 200, {
            type: 'gp',
            b64: Buffer.from(rev.data).toString('base64'),
            revision: { id: rev.id, date: rev.date },
          })
        }
        return json(res, 200, { type: 'tex', tex: row.tex, revision: null })
      }

      if (req.method === 'GET' && m[2] === 'revisions') {
        const user = currentUser(req)
        const revs = (qRevisions.all(row.id) as Record<string, unknown>[]).map((r) => ({
          ...r,
          myVote: user
            ? ((qMyVote.get(r.id as number, user.id) as { vote: number } | undefined)?.vote ?? 0)
            : 0,
        }))
        return json(res, 200, revs)
      }

      // 곡별 댓글
      if (m[2] === 'comments') {
        if (req.method === 'GET') {
          const user = currentUser(req)
          const comments = (qComments.all(row.id) as Record<string, unknown>[]).map((c) => ({
            id: c.id,
            text: c.text,
            date: c.date,
            author: c.author,
            mine: user ? c.user_id === user.id : false,
          }))
          return json(res, 200, comments)
        }
        if (req.method === 'POST') {
          const user = currentUser(req)
          if (!user) return json(res, 401, { error: 'sign in required' })
          const body = JSON.parse(await readBody(req)) as { text?: string }
          const text = body.text?.trim()
          if (!text || text.length > 2000) return json(res, 400, { error: 'text required (≤2000)' })
          const date = new Date().toISOString()
          const r = qAddComment.run(row.id, user.id, text, date)
          return json(res, 201, { id: Number(r.lastInsertRowid), text, date, author: user.name, mine: true })
        }
      }

      // 새 리비전 게시 (위키 모델: 로그인한 누구나)
      if (req.method === 'POST' && m[2] === 'revisions') {
        const user = currentUser(req)
        if (!user) return json(res, 401, { error: 'sign in required' })
        const body = JSON.parse(await readBody(req)) as { b64?: string; source?: string }
        if (!body.b64) return json(res, 400, { error: 'b64 required' })
        const data = Buffer.from(body.b64, 'base64')
        if (data.length > 5_000_000) return json(res, 413, { error: 'too large' })
        const source = ['editor', 'upload', 'ai'].includes(body.source ?? '') ? body.source : 'editor'
        const date = new Date().toISOString()
        const r = qAddRev.run(row.id, date, data, user.id)
        db.prepare('UPDATE revisions SET source = ? WHERE id = ?').run(source!, Number(r.lastInsertRowid))
        return json(res, 201, { id: Number(r.lastInsertRowid), date, author: user.name, source })
      }

      // 원본으로 되돌리기 (리비전 전체 삭제, 로그인 필요)
      if (req.method === 'DELETE' && m[2] === 'revisions') {
        if (!currentUser(req)) return json(res, 401, { error: 'sign in required' })
        qClearRevs.run(row.id)
        return json(res, 200, { ok: true })
      }
    }

    // POST /api/revisions/:id/vote — 정확도 투표 (1 | -1 | 0=취소)
    const mv = path.match(/^\/api\/revisions\/(\d+)\/vote$/)
    if (mv && req.method === 'POST') {
      const user = currentUser(req)
      if (!user) return json(res, 401, { error: 'sign in required' })
      const revId = Number(mv[1])
      if (!qRevById.get(revId)) return json(res, 404, { error: 'revision not found' })
      const body = JSON.parse(await readBody(req)) as { vote?: number }
      const vote = body.vote === 1 ? 1 : body.vote === -1 ? -1 : 0
      if (vote === 0) qDelVote.run(revId, user.id)
      else qUpsertVote.run(revId, user.id, vote)
      const score = (
        db.prepare('SELECT COALESCE(SUM(vote), 0) AS s FROM revision_votes WHERE revision_id = ?').get(revId) as { s: number }
      ).s
      return json(res, 200, { score, myVote: vote })
    }

    // DELETE /api/comments/:id — 본인 댓글 삭제
    const mc = path.match(/^\/api\/comments\/(\d+)$/)
    if (mc && req.method === 'DELETE') {
      const user = currentUser(req)
      if (!user) return json(res, 401, { error: 'sign in required' })
      const comment = qCommentById.get(Number(mc[1])) as { id: number; user_id: number } | undefined
      if (!comment) return json(res, 404, { error: 'comment not found' })
      if (comment.user_id !== user.id) return json(res, 403, { error: '본인 댓글만 삭제할 수 있습니다' })
      qDelComment.run(comment.id)
      return json(res, 200, { ok: true })
    }

    // GET /api/revisions/:id/content — 특정 리비전 열람
    const mr = path.match(/^\/api\/revisions\/(\d+)\/content$/)
    if (mr && req.method === 'GET') {
      const rev = qRevById.get(Number(mr[1])) as
        | { id: number; date: string; data: Uint8Array }
        | undefined
      if (!rev) return json(res, 404, { error: 'revision not found' })
      return json(res, 200, {
        type: 'gp',
        b64: Buffer.from(rev.data).toString('base64'),
        revision: { id: rev.id, date: rev.date },
      })
    }

    // ── 정적 파일 서빙 (프로덕션: web/dist 빌드가 있으면 단일 서버로 배포) ──
    if (req.method === 'GET' && !path.startsWith('/api/')) {
      const safePath = normalize(path).replace(/^(\.\.[/\\])+/, '')
      let file = join(WEB_DIST, safePath === '/' ? 'index.html' : safePath)
      if (!existsSync(file) || statSync(file).isDirectory()) {
        file = join(WEB_DIST, 'index.html') // SPA 라우트 폴백
      }
      if (existsSync(file)) {
        res.writeHead(200, {
          'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        })
        res.end(readFileSync(file))
        return
      }
    }

    return json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    return json(res, 500, { error: String(e) })
  }
})

server.listen(PORT, () => {
  console.log(`songcopy-server listening on http://localhost:${PORT}`)
})
