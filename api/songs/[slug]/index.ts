import { findBySlug, songMeta, type Req, type Res } from '../../_lib'

export default function handler(req: Req, res: Res) {
  const song = findBySlug(String(req.query.slug ?? ''))
  if (!song) return res.status(404).json({ error: 'song not found' })
  res.status(200).json(songMeta(song))
}
