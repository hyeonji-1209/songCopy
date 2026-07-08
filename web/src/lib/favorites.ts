import { useEffect, useState } from 'react'
import { getUser } from './auth'

const KEY = 'songcopy:favorites'
const EVENT = 'songcopy:favorites-changed'

export function getFavorites(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function setLocal(favs: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(favs))
  window.dispatchEvent(new Event(EVENT))
}

function pushToServer(): void {
  if (!getUser()) return
  void fetch('/api/favorites', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slugs: getFavorites() }),
  }).catch(() => {})
}

export function toggleFavorite(slug: string): void {
  const favs = getFavorites()
  const next = favs.includes(slug) ? favs.filter((s) => s !== slug) : [...favs, slug]
  setLocal(next)
  pushToServer()
}

/** 로그인 시 로컬·서버 즐겨찾기를 합집합으로 동기화 */
export async function syncFavoritesWithServer(): Promise<void> {
  if (!getUser()) return
  try {
    const res = await fetch('/api/favorites')
    if (!res.ok) return
    const server = (await res.json()) as string[]
    const merged = [...new Set([...server, ...getFavorites()])]
    setLocal(merged)
    pushToServer()
  } catch {
    /* 오프라인 등 — 로컬만 사용 */
  }
}

export function useFavorites(): string[] {
  const [favs, setFavs] = useState<string[]>(getFavorites)
  useEffect(() => {
    const update = () => setFavs(getFavorites())
    window.addEventListener(EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return favs
}
