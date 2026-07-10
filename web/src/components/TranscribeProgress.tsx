// 화면 우하단 채보 큐 위젯 — 예약한 곡들의 진행률을 한 카드에 쌓아서 표시
import { useNavigate } from 'react-router-dom'
import { cancelJob, dismissJob, useTranscribeJobs } from '../lib/transcribeJob'

export default function TranscribeProgress() {
  const jobs = useTranscribeJobs()
  const navigate = useNavigate()
  if (jobs.length === 0) return null

  return (
    <div className="transcribe-widget">
      {jobs.map((job) => (
        <div key={job.id} className={`tw-job ${job.status}`}>
          <div className="tw-head">
            <span className="tw-title">🤖 {job.title}</span>
            {(job.status === 'queued' || job.status === 'running') && (
              <button
                className="tw-close"
                title="채보 중지"
                onClick={() => {
                  if (window.confirm(`"${job.title}" 채보를 중지할까요?`)) void cancelJob(job.id)
                }}
              >
                ⏹
              </button>
            )}
            {(job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') && (
              <button className="tw-close" onClick={() => dismissJob(job.id)} aria-label="닫기">
                ×
              </button>
            )}
          </div>
          {job.status === 'failed' ? (
            <p className="tw-error">실패: {job.error ?? '알 수 없는 오류'}</p>
          ) : job.status === 'cancelled' ? (
            <p className="tw-stage">⏹ 중지됨</p>
          ) : job.status === 'done' ? (
            <button
              className="auth-submit tw-open"
              onClick={() => {
                const slug = job.slug
                dismissJob(job.id)
                if (slug) navigate(`/tab/${slug}`)
              }}
            >
              ✅ 완성! 악보 보기
            </button>
          ) : job.status === 'queued' && (job.ahead ?? 0) > 0 ? (
            <p className="tw-stage">⏳ 대기 중 — 앞에 {job.ahead}곡</p>
          ) : (
            <>
              <div className="tw-bar">
                <div className="tw-fill" style={{ width: `${Math.max(3, job.progress)}%` }} />
              </div>
              <p className="tw-stage">
                {job.stage}… {job.progress}%
              </p>
            </>
          )}
        </div>
      ))}
      <p className="tw-note">채보하는 동안 다른 곡을 구경해도 돼요 · 최대 5곡 예약</p>
    </div>
  )
}
