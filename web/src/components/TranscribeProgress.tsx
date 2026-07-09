// 화면 우하단 채보 진행률 위젯 — 어느 페이지에서든 보임
import { useNavigate } from 'react-router-dom'
import { dismissTranscribeJob, useTranscribeJob } from '../lib/transcribeJob'

export default function TranscribeProgress() {
  const job = useTranscribeJob()
  const navigate = useNavigate()
  if (!job) return null

  return (
    <div className={`transcribe-widget ${job.status}`}>
      <div className="tw-head">
        <span className="tw-title">🤖 {job.title}</span>
        <button className="tw-close" onClick={dismissTranscribeJob} aria-label="닫기">
          ×
        </button>
      </div>
      {job.status === 'failed' ? (
        <p className="tw-error">실패: {job.error ?? '알 수 없는 오류'}</p>
      ) : job.status === 'done' ? (
        <button
          className="auth-submit tw-open"
          onClick={() => {
            const slug = job.slug
            dismissTranscribeJob()
            if (slug) navigate(`/tab/${slug}`)
          }}
        >
          ✅ 완성! 악보 보기
        </button>
      ) : (
        <>
          <div className="tw-bar">
            <div className="tw-fill" style={{ width: `${Math.max(3, job.progress)}%` }} />
          </div>
          <p className="tw-stage">
            {job.stage}… {job.progress}%
          </p>
          <p className="tw-note">채보하는 동안 다른 곡을 구경해도 돼요</p>
        </>
      )}
    </div>
  )
}
