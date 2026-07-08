// Vercel 데모 배포용 읽기 전용 API 헬퍼.
// SQLite가 서버리스에서 유지되지 않으므로 시드 곡만 서빙하고, 계정·리비전 게시는 비활성화한다.
// _seed.ts는 web/src/data/songs.ts의 복사본 (원본 수정 시 함께 갱신할 것)
import { SONGS, type SongDef } from './_seed'

export { SONGS }
export type { SongDef }

export const DEMO_MESSAGE =
  '데모 배포에서는 계정·리비전 저장 기능이 비활성화되어 있습니다. (서버리스 환경 — DB 없음)'

export interface Req {
  method?: string
  query: Record<string, string | string[] | undefined>
}

export interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

export function songMeta(s: SongDef) {
  return {
    slug: s.slug,
    title: s.title,
    artist: s.artist,
    instruments: s.instruments,
    seedDate: s.revisionDate,
    latestRevision: null,
    revisionCount: 0,
  }
}

export function findBySlug(slug: string): SongDef | undefined {
  return SONGS.find((s) => s.slug === decodeURIComponent(slug))
}
