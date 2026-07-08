// 데모 API 전체를 하나의 캐치올 함수로 처리 (Hobby 플랜 함수 12개 제한 대응)
import { DEMO_MESSAGE, findBySlug, SONGS, songMeta, type Req, type Res } from './_lib'

export default function handler(req: Req & { url?: string }, res: Res) {
  // req.url 기준으로 /api/ 이후 경로를 직접 파싱 (query.path 의존 제거)
  const pathname = (req.url ?? '').split('?')[0]
  const parts = pathname
    .replace(/^\/?api\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  const [a, b, c] = parts
  const method = req.method ?? 'GET'

  // /api/songs
  if (a === 'songs' && !b) {
    if (method === 'POST') return res.status(503).json({ error: DEMO_MESSAGE })
    const pattern = String(req.query.pattern ?? '')
      .trim()
      .toLowerCase()
    let songs = SONGS
    if (pattern) {
      songs = songs.filter(
        (s) => s.title.toLowerCase().includes(pattern) || s.artist.toLowerCase().includes(pattern),
      )
    }
    return res.status(200).json(songs.map(songMeta))
  }

  // /api/songs/:slug[/...]
  if (a === 'songs' && b) {
    const song = findBySlug(b)
    if (!song) return res.status(404).json({ error: 'song not found' })
    if (!c) return res.status(200).json(songMeta(song))
    if (c === 'content') {
      return res.status(200).json({ type: 'tex', tex: song.tex, revision: null })
    }
    if (c === 'revisions') {
      if (method === 'GET') return res.status(200).json([])
      return res.status(503).json({ error: DEMO_MESSAGE })
    }
    if (c === 'comments') {
      if (method === 'GET') return res.status(200).json([])
      return res.status(503).json({ error: DEMO_MESSAGE })
    }
  }

  // /api/transcribe — 데모에서는 비활성 (python 필요)
  if (a === 'transcribe') return res.status(503).json({ error: DEMO_MESSAGE })

  // /api/auth/*
  if (a === 'auth') {
    if (b === 'me') return res.status(200).json(null)
    if (b === 'signout') return res.status(200).json({ ok: true })
    return res.status(503).json({ error: DEMO_MESSAGE })
  }

  // /api/favorites, /api/revisions/:id/*, /api/comments/:id
  if (a === 'favorites') return res.status(401).json({ error: DEMO_MESSAGE })
  if (a === 'revisions' && c === 'vote') return res.status(503).json({ error: DEMO_MESSAGE })
  if (a === 'revisions' && c === 'content') return res.status(404).json({ error: 'demo: no revisions' })
  if (a === 'comments') return res.status(503).json({ error: DEMO_MESSAGE })

  res.status(404).json({ error: 'not found' })
}
