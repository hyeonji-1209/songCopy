// AI 채보 잡 추적: 제출 후 진행률을 폴링하고 어느 페이지에서든 위젯으로 보여준다.
// 페이지 새로고침에도 살아남게 jobId는 localStorage에 보관.
import { useSyncExternalStore } from 'react'
import { fetchTranscribeJob, type TranscribeJobStatus } from './api'

const KEY = 'songcopy:transcribe-job'

interface JobState extends TranscribeJobStatus {
  title: string
}

let state: JobState | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function poll() {
  if (!state) return
  try {
    const s = await fetchTranscribeJob(state.id)
    state = { ...state, ...s }
    if (s.status === 'done' || s.status === 'failed') stopPolling()
    emit()
  } catch {
    // 서버 재시작 등으로 잡이 사라진 경우
    state = state && { ...state, status: 'failed', error: '작업 정보를 찾을 수 없습니다 (서버 재시작?)' }
    stopPolling()
    emit()
  }
}

function startPolling() {
  if (timer) return
  timer = setInterval(() => void poll(), 2000)
  void poll()
}

function stopPolling() {
  if (timer) clearInterval(timer)
  timer = null
  localStorage.removeItem(KEY)
}

export function trackTranscribeJob(id: string, title: string) {
  state = { id, title, status: 'queued', stage: '대기 중', progress: 0, slug: null, error: null }
  localStorage.setItem(KEY, JSON.stringify({ id, title }))
  startPolling()
  emit()
}

export function dismissTranscribeJob() {
  state = null
  stopPolling()
  emit()
}

// 앱 시작 시 미완료 잡 복원
const saved = localStorage.getItem(KEY)
if (saved) {
  try {
    const { id, title } = JSON.parse(saved) as { id: string; title: string }
    state = { id, title, status: 'queued', stage: '확인 중', progress: 0, slug: null, error: null }
    startPolling()
  } catch {
    localStorage.removeItem(KEY)
  }
}

export function useTranscribeJob(): JobState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}
