const SHORTCUTS: Array<[string, string]> = [
  ['Space', '재생 / 일시정지'],
  ['Backspace', '곡 처음으로 이동'],
  ['T', '트랙 목록 표시'],
  ['S', '재생 속도 패널'],
  ['Shift + 1~8', '속도 프리셋 (15~175%)'],
  ['Shift + A / D', '속도 미세 조정 (±1%)'],
  ['L', '루프 켜기/끄기'],
  ['Shift + ← / →', '루프 오른쪽 경계 이동 (마디 단위)'],
  ['N', '메트로놈 켜기/끄기'],
  ['C', '카운트인 켜기/끄기'],
  ['M', '현재 트랙 뮤트'],
  ['Alt + M', '현재 트랙 솔로'],
  ['R', '피치 시프트 패널'],
  ['F', '지판(프렛보드) 표시'],
  ['V', '오디오 소스 전환 (원본/신디시스)'],
  ['E', '편집 모드 — 노트 클릭 후 0~9 프렛 입력, ↑↓←→ 이동, Del 삭제'],
]

interface Props {
  onClose: () => void
}

export default function HelpModal({ onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>키보드 단축키</h2>
          <button className="modal-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <table className="shortcut-table">
          <tbody>
            {SHORTCUTS.map(([key, desc]) => (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="modal-note">악보를 드래그하면 구간이 선택되고, 루프로 반복 연습할 수 있습니다.</p>
      </div>
    </div>
  )
}
