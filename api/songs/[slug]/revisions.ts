import { DEMO_MESSAGE, findBySlug, type Req, type Res } from '../../_lib'

export default function handler(req: Req, res: Res) {
  const song = findBySlug(String(req.query.slug ?? ''))
  if (!song) return res.status(404).json({ error: 'song not found' })
  if (req.method === 'GET') return res.status(200).json([])
  res.status(503).json({ error: DEMO_MESSAGE })
}
