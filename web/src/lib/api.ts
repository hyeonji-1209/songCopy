export interface RevisionInfo {
  id: number
  date: string
  author?: string | null
}

export interface SongMeta {
  slug: string
  title: string
  artist: string
  instruments: string[]
  seedDate: string
  latestRevision: RevisionInfo | null
  revisionCount: number
}

export type SongContent =
  | { type: 'tex'; tex: string; revision: null }
  | { type: 'gp'; b64: string; revision: RevisionInfo }

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function toBase64(data: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) {
    bin += String.fromCharCode(...data.subarray(i, i + chunk))
  }
  return btoa(bin)
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return (await res.json()) as T
}

export const fetchSongs = (pattern = '') =>
  req<SongMeta[]>(`/api/songs${pattern ? `?pattern=${encodeURIComponent(pattern)}` : ''}`)

export const fetchSong = (slug: string) => req<SongMeta>(`/api/songs/${slug}`)

export const fetchContent = (slug: string) => req<SongContent>(`/api/songs/${slug}/content`)

export const fetchRevisions = (slug: string) => req<RevisionInfo[]>(`/api/songs/${slug}/revisions`)

export const fetchRevisionContent = (id: number) =>
  req<Extract<SongContent, { type: 'gp' }>>(`/api/revisions/${id}/content`)

export const postRevision = (slug: string, data: Uint8Array) =>
  req<RevisionInfo>(`/api/songs/${slug}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ b64: toBase64(data) }),
  })

export const clearRevisions = (slug: string) =>
  req<{ ok: boolean }>(`/api/songs/${slug}/revisions`, { method: 'DELETE' })

export function formatRevDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR')
}
