import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSong } from '../lib/api'
import OpenFileButton from './OpenFileButton'

export default function NewTabMenu() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      const { slug } = await createSong(title.trim(), artist.trim())
      setOpen(false)
      setTitle('')
      setArtist('')
      navigate(`/tab/${slug}`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        alert('빈 탭을 만들려면 로그인이 필요합니다.')
      } else {
        alert('탭 생성에 실패했습니다.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="newtab-anchor">
      <button className="nav-item nav-button" onClick={() => setOpen((v) => !v)}>
        <span className="nav-icon">📄</span>새 타브
      </button>
      {open && (
        <span className="newtab-menu">
          <form className="newtab-form" onSubmit={create}>
            <span className="panel-title">빈 탭 만들기</span>
            <input
              type="text"
              placeholder="곡 제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
            <input
              type="text"
              placeholder="아티스트"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={busy || !title.trim()}>
              {busy ? '생성 중…' : '만들기 → 에디터로'}
            </button>
          </form>
          <div className="newtab-divider">또는</div>
          <OpenFileButton className="upload-btn newtab-upload">
            📄 Guitar Pro / MusicXML 파일 열기
          </OpenFileButton>
        </span>
      )}
    </span>
  )
}
