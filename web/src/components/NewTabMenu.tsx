import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSong, postTranscribe } from '../lib/api'
import { audioFileToMonoWav } from '../lib/audioConvert'
import { trackTranscribeJob } from '../lib/transcribeJob'
import OpenFileButton from './OpenFileButton'

export default function NewTabMenu() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiTitle, setAiTitle] = useState('')
  const [aiBpm, setAiBpm] = useState('') // 비우면 자동 감지
  const [aiSensitivity, setAiSensitivity] = useState('standard')
  const [aiBusy, setAiBusy] = useState(false)
  const audioRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const transcribe = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = audioRef.current?.files?.[0]
    if (!file || !aiTitle.trim()) return
    setAiBusy(true)
    try {
      // 어떤 포맷이든 모노 22kHz wav로 변환해 용량 축소 (긴 곡도 업로드 가능)
      const data = await audioFileToMonoWav(file)
      const bpm = aiBpm.trim() ? Number(aiBpm) : null
      const { jobId } = await postTranscribe(aiTitle.trim(), bpm, data, 'wav', aiSensitivity)
      // 비동기 잡: 위젯이 진행률을 보여주고, 완료되면 악보로 이동 버튼이 뜬다
      trackTranscribeJob(jobId, aiTitle.trim())
      setOpen(false)
      setAiTitle('')
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        alert('AI 채보를 사용하려면 로그인이 필요합니다.')
      } else if (err instanceof Error && err.message.startsWith('API')) {
        alert(`채보 실패: ${err.message.replace(/^API \d+: /, '')}`)
      } else if (err instanceof Error && /decod/i.test(err.message)) {
        alert('오디오 파일을 읽지 못했습니다. 다른 포맷(mp3/wav)으로 시도해보세요.')
      } else {
        alert('채보에 실패했습니다. (서버의 basic-pitch 설치를 확인하세요)')
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
                placeholder="자동 감지"
                value={aiBpm}
                onChange={(e) => setAiBpm(e.target.value)}
              />
            </label>
            <label className="newtab-bpm">
              민감도
              <select value={aiSensitivity} onChange={(e) => setAiSensitivity(e.target.value)}>
                <option value="precise">정밀 (유령음 최소)</option>
                <option value="standard">표준 (권장)</option>
                <option value="dense">최고 정확도 (다중 시도, 2~4배 느림)</option>
              </select>
            </label>
            <button className="auth-submit" type="submit" disabled={aiBusy || !aiTitle.trim()}>
              {aiBusy ? '접수 중…' : '악보 만들기'}
            </button>
            <span className="panel-note">mp3/wav/m4a 등 — 최대 8분까지 분석. BPM 비우면 자동 감지.</span>
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
