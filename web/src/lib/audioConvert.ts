/**
 * 오디오 파일을 모노 22.05kHz 16bit WAV로 변환.
 * 채보 모델(basic-pitch)이 어차피 22kHz 모노로 리샘플하므로 품질 손실 없이
 * 업로드 용량을 대폭 줄인다 (4분 스테레오 wav 40MB → 약 10MB).
 * 브라우저가 디코딩할 수 있는 모든 포맷(mp3/wav/ogg/m4a/flac…)을 받는다.
 */
const TARGET_RATE = 22050
const MAX_SECONDS = 480 // 분석 상한 8분 (모노 22kHz 기준 서버 32MB 제한 내)

export async function audioFileToMonoWav(file: File): Promise<Uint8Array> {
  const raw = await file.arrayBuffer()
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(raw)
  } finally {
    void ctx.close()
  }

  const seconds = Math.min(decoded.duration, MAX_SECONDS)
  const length = Math.ceil(seconds * TARGET_RATE)
  const offline = new OfflineAudioContext(1, length, TARGET_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)

  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, TARGET_RATE, true)
  view.setUint32(28, TARGET_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}
