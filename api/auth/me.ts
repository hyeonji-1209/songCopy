import type { Req, Res } from '../_lib'

export default function handler(_req: Req, res: Res) {
  res.status(200).json(null)
}
