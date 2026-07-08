import { useState } from 'react'
import { signin, signup } from '../lib/auth'

interface Props {
  onClose: () => void
}

export default function AuthModal({ onClose }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signup') await signup(name, email, password)
      else await signin(email, password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{mode === 'signin' ? '로그인' : '가입하기'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="auth-tabs">
          <button
            className={`chip ${mode === 'signin' ? 'on' : ''}`}
            onClick={() => setMode('signin')}
          >
            로그인
          </button>
          <button
            className={`chip ${mode === 'signup' ? 'on' : ''}`}
            onClick={() => setMode('signup')}
          >
            가입하기
          </button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="비밀번호 (4자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
          />
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? '처리 중…' : mode === 'signin' ? '로그인' : '가입하기'}
          </button>
        </form>
        <p className="modal-note">
          로그인하면 리비전 게시와 즐겨찾기 서버 동기화를 사용할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
