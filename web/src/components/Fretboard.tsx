const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FRETS = 15
const MARKER_FRETS = new Set([3, 5, 7, 9, 12, 15])

function noteName(midi: number): string {
  return NOTE_NAMES[midi % 12]
}

export interface ActiveNote {
  /** alphaTab 모델 기준: 1 = 가장 낮은 현 */
  string: number
  fret: number
}

interface Props {
  /** 미디 값 배열, index 0 = 가장 높은 현 (alphaTab Staff.tuning 순서) */
  tuning: number[]
  active: ActiveNote[]
  leftHanded: boolean
}

export default function Fretboard({ tuning, active, leftHanded }: Props) {
  if (tuning.length === 0) {
    return <div className="fretboard-empty">이 트랙은 지판 표시를 지원하지 않습니다.</div>
  }

  const stringCount = tuning.length
  // 표시 행 i(위=높은 현) ← 모델 string s: i = stringCount - s
  const activeByRow = new Map<number, Set<number>>()
  for (const n of active) {
    const row = stringCount - n.string
    if (!activeByRow.has(row)) activeByRow.set(row, new Set())
    activeByRow.get(row)!.add(n.fret)
  }

  const fretOrder = Array.from({ length: FRETS + 1 }, (_, f) => f)
  if (leftHanded) fretOrder.reverse()

  return (
    <div className="fretboard">
      {tuning.map((midi, row) => (
        <div className="fb-row" key={row}>
          <span className="fb-label">{noteName(midi)}</span>
          {fretOrder.map((fret) => {
            const on = activeByRow.get(row)?.has(fret)
            return (
              <span key={fret} className={`fb-cell ${fret === 0 ? 'nut' : ''}`}>
                <span className="fb-string-line" />
                {on && <span className="fb-dot">{fret}</span>}
              </span>
            )
          })}
        </div>
      ))}
      <div className="fb-row fb-numbers">
        <span className="fb-label" />
        {fretOrder.map((fret) => (
          <span key={fret} className={`fb-cell num ${MARKER_FRETS.has(fret) ? 'marker' : ''}`}>
            {fret === 0 ? '' : fret}
          </span>
        ))}
      </div>
    </div>
  )
}
