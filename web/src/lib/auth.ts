import { useEffect, useState } from 'react'

export interface User {
  name: string
  email: string
}

const EVENT = 'songcopy:auth-changed'
let current: User | null = null
let loadStarted = false

export function getUser(): User | null {
  return current
}

async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me')
    current = res.ok ? ((await res.json()) as User | null) : null
  } catch {
    current = null
  }
  window.dispatchEvent(new Event(EVENT))
}

export function useUser(): User | null {
  const [user, setUser] = useState(current)
  useEffect(() => {
    if (!loadStarted) {
      loadStarted = true
      void refresh()
    }
    const update = () => setUser(current)
    window.addEventListener(EVENT, update)
    return () => window.removeEventListener(EVENT, update)
  }, [])
  return user
}

async function authPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `오류 (${res.status})`)
  }
  await refresh()
}

export const signup = (name: string, email: string, password: string) =>
  authPost('/api/auth/signup', { name, email, password })

export const signin = (email: string, password: string) =>
  authPost('/api/auth/signin', { email, password })

export const signout = () => authPost('/api/auth/signout', {})
