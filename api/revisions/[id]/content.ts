import type { Req, Res } from '../../_lib'

export default function handler(_req: Req, res: Res) {
  res.status(404).json({ error: 'demo: no revisions' })
}
