// AI 채보 잡 추적: 여러 곡을 예약(큐)하고 각각의 진행률을 폴링, 어느 페이지에서든 위젯으로 표시.
// 새로고침에도 살아남게 활성 잡 목록을 localStorage에 보관.
import { useSyncExternalStore } from 'react'
import { cancelTranscribeJob, fetchTranscribeJob, type TranscribeJobStatus } from './api'

const KEY = 'songcopy:transcribe-jobs'

export interface JobState extends TranscribeJobStatus {
  title: string
  ahead?: number // 내 앞 대기/실행 중인 잡 수
}

let jobs: JobState[] = []
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function emit() {
  jobs = [...jobs] // useSyncExternalStore 스냅샷 참조 갱신
  for (const l of listeners) l()
}

const isActive = (j: JobState) => j.status === 'queued' || j.status === 'running'

function save() {
  const active = jobs.filter(isActive).map((j) => ({ id: j.id, title: j.title }))
  if (active.length) localStorage.setItem(KEY, JSON.stringify(active))
  else localStorage.removeItem(KEY)
}

async function poll() {
  const active = jobs.filter(isActive)
  if (active.length === 0) {
    stopPolling()
    return
  }
  await Promise.all(
    active.map(async (j) => {
      try {
        const s = (await fetchTranscribeJob(j.id)) as JobState
        Object.assign(j, s)
      } catch {
        j.status = 'failed'
        j.error = '작업 정보를 찾을 수 없습니다 (서버 재시작?)'
      }
    }),
  )
  save()
  emit()
}

function startPolling() {
  if (timer) return
  timer = setInterval(() => void poll(), 2000)
  void poll()
}

function stopPolling() {
  if (timer) clearInterval(timer)
  timer = null
}

export function trackTranscribeJob(id: string, title: string) {
  jobs.push({ id, title, status: 'queued', stage: '대기 중', progress: 0, slug: null, error: null })
  save()
  startPolling()
  emit()
}

export function dismissJob(id: string) {
  jobs = jobs.filter((j) => j.id !== id)
  save()
  emit()
}

export async function cancelJob(id: string) {
  try {
    await cancelTranscribeJob(id)
  } catch {
    /* 이미 끝났거나 서버 재시작 — 아래에서 상태만 정리 */
  }
  const j = jobs.find((x) => x.id === id)
  if (j && isActive(j)) {
    j.status = 'cancelled'
    j.stage = '중지됨'
  }
  save()
  emit()
}

// 앱 시작 시 미완료 잡 복원
const saved = localStorage.getItem(KEY)
if (saved) {
  try {
    const list = JSON.parse(saved) as Array<{ id: string; title: string }>
    for (const { id, title } of list) {
      jobs.push({ id, title, status: 'queued', stage: '확인 중', progress: 0, slug: null, error: null })
    }
    if (jobs.length) startPolling()
  } catch {
    localStorage.removeItem(KEY)
  }
}

export function useTranscribeJobs(): JobState[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => jobs,
  )
}
