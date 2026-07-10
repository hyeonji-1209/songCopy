// 악보 PNG / 오디오 MP3 내보내기
import * as alphaTab from '@coderline/alphatab'
import { Mp3Encoder } from '@breezystack/lamejs'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)

/** 현재 악보(선택 트랙)를 PNG 이미지로 저장.
 * 숨김 컨테이너에 canvas 엔진으로 다시 렌더 → 세로로 이어붙여 저장 (길면 여러 장). */
export async function exportSheetPng(
  api: alphaTab.AlphaTabApi,
  trackIndexes: number[],
  fileBase: string,
  resources?: Record<string, unknown>,
): Promise<void> {
  if (!api.score) throw new Error('no score')
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-12000px;top:0;width:1200px;background:#fff'
  document.body.appendChild(container)

  const tmp = new alphaTab.AlphaTabApi(container, {
    // 화면 밖 컨테이너라 지연 로딩을 꺼야 전체가 실제로 그려진다
    core: { engine: 'html5', enableLazyLoading: false, fontDirectory: '/font/' },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
      scale: 0.9,
      barsPerRow: 4,
      padding: [24, 24],
      ...(resources ? { resources } : {}),
    },
    player: { playerMode: alphaTab.PlayerMode.Disabled },
  } as never)

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('render timeout')), 60_000)
      tmp.postRenderFinished.on(() => {
        clearTimeout(timer)
        resolve()
      })
      tmp.error.on((e) => {
        clearTimeout(timer)
        reject(e)
      })
      // 메인 api와 모델 공유를 피하기 위해 복제본을 렌더
      const clone = alphaTab.model.JsonConverter.jsObjectToScore(
        alphaTab.model.JsonConverter.scoreToJsObject(api.score!),
        tmp.settings,
      )
      tmp.renderScore(clone, trackIndexes)
    })
    // 잔여 그리기 마무리 대기
    await new Promise((r) => setTimeout(r, 300))

    const canvases = [...container.querySelectorAll('canvas')] as HTMLCanvasElement[]
    if (canvases.length === 0) throw new Error('no canvas rendered')
    const cRect = container.getBoundingClientRect()
    const parts = canvases
      .map((c) => ({ c, top: c.getBoundingClientRect().top - cRect.top, left: c.getBoundingClientRect().left - cRect.left }))
      .sort((a, b) => a.top - b.top)
    const totalW = Math.max(...parts.map((p) => p.left + p.c.width))
    const totalH = Math.max(...parts.map((p) => p.top + p.c.height))

    // 캔버스 최대 치수(~32k) 안전선 아래로 슬라이스
    const SLICE = 20000
    const sliceCount = Math.ceil(totalH / SLICE)
    for (let i = 0; i < sliceCount; i++) {
      const y0 = i * SLICE
      const h = Math.min(SLICE, totalH - y0)
      const out = document.createElement('canvas')
      out.width = totalW
      out.height = h
      const ctx = out.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, totalW, h)
      for (const p of parts) {
        if (p.top + p.c.height < y0 || p.top > y0 + h) continue
        ctx.drawImage(p.c, p.left, p.top - y0)
      }
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
      if (!blob) throw new Error('png encode failed')
      const suffix = sliceCount > 1 ? `_${i + 1}of${sliceCount}` : ''
      downloadBlob(blob, `${sanitize(fileBase)}${suffix}.png`)
    }
  } finally {
    tmp.destroy()
    container.remove()
  }
}

/** 현재 믹서 상태(뮤트/솔로/볼륨) 그대로 신스 오디오를 MP3로 저장 */
export async function exportMp3(
  api: alphaTab.AlphaTabApi,
  mixer: Array<{ index: number; mute: boolean; solo: boolean; volume: number }>,
  fileBase: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (!api.score) throw new Error('no score')
  const options = new alphaTab.synth.AudioExportOptions()
  options.sampleRate = 44100
  options.masterVolume = 1
  const anySolo = mixer.some((t) => t.solo)
  for (const t of mixer) {
    const audible = !t.mute && (!anySolo || t.solo)
    options.trackVolume.set(t.index, audible ? t.volume / 100 : 0)
  }

  const exporter = await api.exportAudio(options)
  const sampleRate = options.sampleRate
  const encoder = new Mp3Encoder(2, sampleRate, 192)
  const mp3Parts: Uint8Array[] = []
  try {
    for (;;) {
      const chunk = await exporter.render(1000)
      if (!chunk) break
      onProgress?.(Math.min(99, Math.round((chunk.currentTime / (chunk.endTime || 1)) * 100)))
      const s = chunk.samples // 스테레오 인터리브 float32
      const n = s.length / 2
      const left = new Int16Array(n)
      const right = new Int16Array(n)
      for (let i = 0; i < n; i++) {
        left[i] = Math.max(-32768, Math.min(32767, s[i * 2] * 32767))
        right[i] = Math.max(-32768, Math.min(32767, s[i * 2 + 1] * 32767))
      }
      const enc = encoder.encodeBuffer(left, right)
      if (enc.length > 0) mp3Parts.push(new Uint8Array(enc))
    }
    const tail = encoder.flush()
    if (tail.length > 0) mp3Parts.push(new Uint8Array(tail))
  } finally {
    exporter.destroy()
  }
  downloadBlob(new Blob(mp3Parts as BlobPart[], { type: 'audio/mpeg' }), `${sanitize(fileBase)}.mp3`)
  onProgress?.(100)
}
