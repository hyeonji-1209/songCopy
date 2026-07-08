import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'songcopy:theme'
const EVENT = 'songcopy:theme-changed'

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme)
  document.documentElement.dataset.theme = theme
  window.dispatchEvent(new Event(EVENT))
}

export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>(getTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = getTheme()
    const update = () => setThemeState(getTheme())
    window.addEventListener(EVENT, update)
    return () => window.removeEventListener(EVENT, update)
  }, [])
  return theme
}
