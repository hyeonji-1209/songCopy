import { DEMO_MESSAGE, SONGS, songMeta, type Req, type Res } from '../_lib'

export default function handler(req: Req, res: Res) {
  if (req.method === 'POST') {
    return res.status(503).json({ error: DEMO_MESSAGE })
  }
  const pattern = String(req.query.pattern ?? '')
    .trim()
    .toLowerCase()
  let songs = SONGS
  if (pattern) {
    songs = songs.filter(
      (s) => s.title.toLowerCase().includes(pattern) || s.artist.toLowerCase().includes(pattern),
    )
  }
  res.status(200).json(songs.map(songMeta))
}
