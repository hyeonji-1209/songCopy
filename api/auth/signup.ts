import { DEMO_MESSAGE, type Req, type Res } from '../_lib'

export default function handler(_req: Req, res: Res) {
  res.status(503).json({ error: DEMO_MESSAGE })
}
