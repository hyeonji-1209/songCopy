import { useEffect, useState } from 'react'

export interface UploadedFile {
  name: string
  data: Uint8Array
  version: number
}

const EVENT = 'songcopy:upload-changed'

// 업로드 파일은 세션 메모리에만 보관 (새로고침 시 사라짐)
let current: UploadedFile | null = null

export function setUpload(name: string, data: Uint8Array): void {
  current = { name, data, version: (current?.version ?? 0) + 1 }
  window.dispatchEvent(new Event(EVENT))
}

export function getUpload(): UploadedFile | null {
  return current
}

export function useUpload(): UploadedFile | null {
  const [upload, setUploadState] = useState(current)
  useEffect(() => {
    const update = () => setUploadState(current)
    window.addEventListener(EVENT, update)
    return () => window.removeEventListener(EVENT, update)
  }, [])
  return upload
}
