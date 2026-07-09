// 단색 선 스타일 아이콘 (이모지 대체) — stroke: currentColor
const PATHS: Record<string, React.ReactNode> = {
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" />
    </>
  ),
  guitar: (
    <>
      <circle cx="8" cy="16" r="4.5" />
      <path d="M11.2 12.8L19 5M17.5 3.5l3 3" />
    </>
  ),
  piano: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M7.5 12v7M12 12v7M16.5 12v7M3 12h18" />
    </>
  ),
  synth: (
    <>
      <path d="M5 4v16M12 4v16M19 4v16" />
      <circle cx="5" cy="10" r="2" />
      <circle cx="12" cy="15" r="2" />
      <circle cx="19" cy="8" r="2" />
    </>
  ),
  drum: (
    <>
      <ellipse cx="12" cy="7.5" rx="8" ry="3" />
      <path d="M4 7.5v9c0 1.7 3.6 3 8 3s8-1.3 8-3v-9" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  print: (
    <>
      <path d="M7 8V3.5h10V8" />
      <rect x="3.5" y="8" width="17" height="8" rx="1" />
      <rect x="7" y="13.5" width="10" height="7" />
    </>
  ),
  pencil: <path d="M17 3.5l3.5 3.5L8 19.5l-4.5 1 1-4.5z" />,
  speed: (
    <>
      <path d="M3.5 15.5a8.5 8.5 0 1 1 17 0" />
      <path d="M12 15.5l4.5-4.5" />
    </>
  ),
  loop: (
    <>
      <path d="M16.5 2.5l4 4-4 4M20.5 6.5H7a4 4 0 0 0-4 4v1" />
      <path d="M7.5 21.5l-4-4 4-4M3.5 17.5H17a4 4 0 0 0 4-4v-1" />
    </>
  ),
  metronome: (
    <>
      <path d="M9.5 3h5L18 21H6z" />
      <path d="M12 14.5L17 6" />
    </>
  ),
  fretboard: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M9.5 3v18M14.5 3v18M5 9h14M5 15h14" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5" />
      <path d="M4 20.5h16" />
    </>
  ),
}

export function trackIconName(name: string): string {
  if (name.includes('드럼')) return 'drum'
  if (name.includes('키보드') || name.includes('피아노')) return 'piano'
  if (name.includes('신스')) return 'synth'
  if (name.includes('보컬') || name.includes('멜로디')) return 'mic'
  return 'guitar'
}

export default function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name] ?? null}
    </svg>
  )
}
