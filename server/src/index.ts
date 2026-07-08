import http from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
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

// 시드: web/src/data/songs.ts 가 단일 소스
const insertSong = db.prepare(
  'INSERT OR IGNORE INTO songs (slug, title, artist, instruments, seed_date, tex) VALUES (?, ?, ?, ?, ?, ?)',
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
}

const qList = db.prepare('SELECT * FROM songs ORDER BY title')
const qBySlug = db.prepare('SELECT * FROM songs WHERE slug = ?')
const qRevisions = db.prepare(
  `SELECT r.id, r.date, u.name AS author FROM revisions r
   LEFT JOIN users u ON u.id = r.user_id WHERE r.song_id = ? ORDER BY r.id DESC`,
)
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
    latestRevision: revs[0] ?? null,
    revisionCount: revs.length,
  }
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
    const m = path.match(/^\/api\/songs\/([^/]+)(?:\/(content|revisions))?$/)
    if (m) {
      const row = qBySlug.get(m[1]) as SongRow | undefined
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
        return json(res, 200, qRevisions.all(row.id))
      }

      // 새 리비전 게시 (위키 모델: 로그인한 누구나)
      if (req.method === 'POST' && m[2] === 'revisions') {
        const user = currentUser(req)
        if (!user) return json(res, 401, { error: 'sign in required' })
        const body = JSON.parse(await readBody(req)) as { b64?: string }
        if (!body.b64) return json(res, 400, { error: 'b64 required' })
        const data = Buffer.from(body.b64, 'base64')
        if (data.length > 5_000_000) return json(res, 413, { error: 'too large' })
        const date = new Date().toISOString()
        const r = qAddRev.run(row.id, date, data, user.id)
        return json(res, 201, { id: Number(r.lastInsertRowid), date, author: user.name })
      }

      // 원본으로 되돌리기 (리비전 전체 삭제, 로그인 필요)
      if (req.method === 'DELETE' && m[2] === 'revisions') {
        if (!currentUser(req)) return json(res, 401, { error: 'sign in required' })
        qClearRevs.run(row.id)
        return json(res, 200, { ok: true })
      }
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
