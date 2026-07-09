export interface RevisionInfo {
  id: number
  date: string
  author?: string | null
  source?: string
  score?: number
  myVote?: number
}

export interface CommentInfo {
  id: number
  text: string
  date: string
  author: string | null
  mine: boolean
}

export interface SongMeta {
  slug: string
  title: string
  artist: string
  instruments: string[]
  seedDate: string
  source?: string | null
  lyrics?: string | null
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
  if (!res.ok) {
    let detail = path
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) detail = data.error
    } catch {
      /* 본문 없음 */
    }
    throw new Error(`API ${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

export const fetchSongs = (pattern = '') =>
  req<SongMeta[]>(`/api/songs${pattern ? `?pattern=${encodeURIComponent(pattern)}` : ''}`)

export const fetchSong = (slug: string) => req<SongMeta>(`/api/songs/${slug}`)

export const fetchContent = (slug: string) => req<SongContent>(`/api/songs/${slug}/content`)

export const fetchRevisions = (slug: string) => req<RevisionInfo[]>(`/api/songs/${slug}/revisions`)

export const fetchRevisionContent = (id: number) =>
  req<Extract<SongContent, { type: 'gp' }>>(`/api/revisions/${id}/content`)

export const postRevision = (slug: string, data: Uint8Array, source = 'editor') =>
  req<RevisionInfo>(`/api/songs/${slug}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ b64: toBase64(data), source }),
  })

export const voteRevision = (id: number, vote: 1 | -1 | 0) =>
  req<{ score: number; myVote: number }>(`/api/revisions/${id}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vote }),
  })

export const fetchComments = (slug: string) => req<CommentInfo[]>(`/api/songs/${slug}/comments`)

export const postComment = (slug: string, text: string) =>
  req<CommentInfo>(`/api/songs/${slug}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

export const deleteComment = (id: number) =>
  req<{ ok: boolean }>(`/api/comments/${id}`, { method: 'DELETE' })

export const postTranscribe = (
  title: string,
  bpm: number | null,
  data: Uint8Array,
  ext: string,
  sensitivity = 'standard',
) =>
  req<{ jobId: string }>('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, bpm: bpm ?? undefined, b64: toBase64(data), ext, sensitivity }),
  })

export interface TranscribeJobStatus {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  stage: string
  progress: number
  slug: string | null
  error: string | null
}

export const fetchTranscribeJob = (id: string) =>
  req<TranscribeJobStatus>(`/api/transcribe/jobs/${id}`)

export const createSong = (title: string, artist: string) =>
  req<{ slug: string }>('/api/songs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, artist }),
  })

export const clearRevisions = (slug: string) =>
  req<{ ok: boolean }>(`/api/songs/${slug}/revisions`, { method: 'DELETE' })

export function formatRevDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR')
}
