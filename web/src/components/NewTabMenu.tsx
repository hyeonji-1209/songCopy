import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSong, postTranscribe } from '../lib/api'
import OpenFileButton from './OpenFileButton'

export default function NewTabMenu() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiTitle, setAiTitle] = useState('')
  const [aiBpm, setAiBpm] = useState(120)
  const [aiBusy, setAiBusy] = useState(false)
  const audioRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const transcribe = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = audioRef.current?.files?.[0]
    if (!file || !aiTitle.trim()) return
    setAiBusy(true)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'wav'
      const { slug } = await postTranscribe(aiTitle.trim(), aiBpm, data, ext)
      setOpen(false)
      setAiTitle('')
      navigate(`/tab/${slug}`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        alert('AI 채보를 사용하려면 로그인이 필요합니다.')
      } else {
        alert('채보에 실패했습니다. (서버의 basic-pitch 설치와 오디오 파일을 확인하세요)')
      }
    } finally {
      setAiBusy(false)
    }
  }

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
          <form className="newtab-form" onSubmit={transcribe}>
            <span className="panel-title">🤖 음악 파일로 AI 채보</span>
            <input ref={audioRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" required />
            <input
              type="text"
              placeholder="곡 제목"
              value={aiTitle}
              onChange={(e) => setAiTitle(e.target.value)}
              required
            />
            <label className="newtab-bpm">
              BPM
              <input
                type="number"
                min={40}
                max={220}
                value={aiBpm}
                onChange={(e) => setAiBpm(Number(e.target.value))}
              />
            </label>
            <button className="auth-submit" type="submit" disabled={aiBusy || !aiTitle.trim()}>
              {aiBusy ? '채보 중… (수십 초 걸려요)' : '악보 만들기'}
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
