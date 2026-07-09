import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as alphaTab from '@coderline/alphatab'
import {
  clearRevisions,
  fetchContent,
  voteRevision,
  fetchRevisionContent,
  fetchRevisions,
  fetchSong,
  formatRevDate,
  fromBase64,
  postRevision,
  type RevisionInfo,
  type SongMeta,
} from '../lib/api'
import { toggleFavorite, useFavorites } from '../lib/favorites'
import { setTheme, useTheme } from '../lib/theme'
import { useUpload } from '../lib/uploadStore'
import Comments from '../components/Comments'
import Fretboard, { type ActiveNote } from '../components/Fretboard'
import Icon, { trackIconName } from '../components/Icon'
import OpenFileButton from '../components/OpenFileButton'

interface TrackInfo {
  index: number
  name: string
  mute: boolean
  solo: boolean
  visible: boolean
  volume: number
}

// 편집기 실행취소용 연산 기록
type NoteEffect = 'palmMute' | 'letRing' | 'vibrato' | 'dead' | 'ghost'
type EditOp =
  | { kind: 'fret'; beat: alphaTab.model.Beat; string: number; before: number | null; after: number | null }
  | { kind: 'duration'; beat: alphaTab.model.Beat; before: number; after: number }
  | { kind: 'effect'; beat: alphaTab.model.Beat; string: number; effect: NoteEffect }

const SPEED_PRESETS = [15, 25, 50, 75, 100, 125, 150, 175]

const DARK_RESOURCES = {
  mainGlyphColor: '#e6e9ec',
  secondaryGlyphColor: 'rgba(230, 233, 236, 0.55)',
  staffLineColor: '#4a545e',
  barSeparatorColor: '#8b95a1',
  barNumberColor: '#6fcf65',
  scoreInfoColor: '#e6e9ec',
}

// 인쇄 팝업은 흰 종이 기준 — 다크 테마 색이 승계되면 안 보이므로 항상 명시
const PRINT_RESOURCES = {
  mainGlyphColor: '#000000',
  secondaryGlyphColor: 'rgba(0, 0, 0, 0.5)',
  staffLineColor: '#222222',
  barSeparatorColor: '#222222',
  barNumberColor: '#3d6d38',
  scoreInfoColor: '#000000',
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SongPage() {
  const { slug } = useParams()
  const isUploaded = slug === '_uploaded'
  const [song, setSong] = useState<SongMeta | null>(null)
  const [songError, setSongError] = useState(false)
  const [showLyrics, setShowLyrics] = useState(true)
  // 상시 사이드바 (믹서/표기/다운로드) — T로 접기/펴기, 상태는 localStorage 유지.
  // 좁은 화면은 악보 공간 확보를 위해 기본 접힘
  const [sidebar, setSidebar] = useState(() => {
    const saved = localStorage.getItem('songcopy:sidebar')
    return saved !== null ? saved !== '0' : window.innerWidth > 900
  })
  const [sideTab, setSideTab] = useState<'mixer' | 'play' | 'settings'>('mixer')
  const [zoom, setZoom] = useState(80) // 악보 배율 % — 80%면 4마디 고정에서도 겹치지 않음
  const [viewMode, setViewMode] = useState<'vertical' | 'horizontal'>('vertical')
  const upload = useUpload()
  const favorites = useFavorites()
  const theme = useTheme()

  const sheetRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const activeTrackRef = useRef(0)

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(100)
  const [pitch, setPitch] = useState(0)
  const [loop, setLoop] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [tracks, setTracks] = useState<TrackInfo[]>([])
  const [activeTrack, setActiveTrack] = useState(0)
  // 한 줄 4마디 고정(모든 마디 같은 폭) + 배율 80% 조합이 기본 — 겹침 없이 정렬됨
  const [fourBars, setFourBars] = useState(true)
  const [dynamics, setDynamics] = useState(true)
  const [notationMode, setNotationMode] = useState<'both' | 'tab' | 'score'>('both')
  const [position, setPosition] = useState({ current: 0, end: 0 })
  const [scoreMeta, setScoreMeta] = useState({ title: '', artist: '' })
  const [showFretboard, setShowFretboard] = useState(false)
  const [leftHanded, setLeftHanded] = useState(false)
  const [tuning, setTuning] = useState<number[]>([])
  const [activeNotes, setActiveNotes] = useState<ActiveNote[]>([])
  const [masterVolume, setMasterVolume] = useState(100)
  const [audioSource, setAudioSource] = useState<'synth' | 'original'>('synth')
  const [syncOffset, setSyncOffset] = useState(0) // 초
  const [syncScale, setSyncScale] = useState(100) // %
  const originalAudioRef = useRef<{ name: string; data: Uint8Array } | null>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const isOriginal = audioSource === 'original'

  // ── 에디터 상태 ──
  const [editMode, setEditMode] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [revision, setRevision] = useState<RevisionInfo | null>(null)
  const [revList, setRevList] = useState<RevisionInfo[] | null>(null)
  const [selVersion, setSelVersion] = useState(0)
  const [overlayRect, setOverlayRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const editModeRef = useRef(false)
  const selRef = useRef<{ beat: alphaTab.model.Beat; string: number } | null>(null)
  const undoStack = useRef<EditOp[]>([])
  const redoStack = useRef<EditOp[]>([])
  const [editHint, setEditHint] = useState<string | null>(null)
  const pendingDigitRef = useRef<{ d: number; t: number } | null>(null)
  const midiReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    editModeRef.current = editMode
  }, [editMode])

  // 사이드바의 특정 탭 열기 (단축키 S/R 등에서 사용)
  const openSideTab = (tab: 'mixer' | 'play' | 'settings') => {
    setSidebar(true)
    localStorage.setItem('songcopy:sidebar', '1')
    setSideTab(tab)
  }

  useEffect(() => {
    activeTrackRef.current = activeTrack
  }, [activeTrack])

  useEffect(() => {
    if (!slug || (isUploaded && !upload) || !sheetRef.current || !viewportRef.current) return
    let cancelled = false

    const api = new alphaTab.AlphaTabApi(sheetRef.current, {
      player: {
        playerMode: alphaTab.PlayerMode.EnabledAutomatic,
        soundFont: '/soundfont/sonivox.sf3',
        enableCursor: true,
        enableUserInteraction: true,
        scrollElement: viewportRef.current,
        scrollOffsetY: -80,
      },
      core: {
        includeNoteBounds: true,
        // vite 플러그인이 public/font 로 복사한 자산을 명시 지정
        // (프로덕션 번들의 자동 경로 추정이 /assets/font 로 어긋나는 문제 방지)
        fontDirectory: '/font/',
      },
      display: {
        layoutMode: alphaTab.LayoutMode.Page,
        scale: 0.8,
        barsPerRow: 4, // 모든 마디 같은 폭, 한 줄 4마디
        padding: [40, 40], // 악보와 테두리 사이 여유
        systemPaddingTop: 22, // 단(시스템) 사이 간격 — 빽빽함 완화
        systemPaddingBottom: 22,
        ...(theme === 'dark' ? { resources: DARK_RESOURCES } : {}),
      },
      notation: {
        elements: new Map([
          [alphaTab.NotationElement.ScoreTitle, false],
          [alphaTab.NotationElement.ScoreSubTitle, false],
          [alphaTab.NotationElement.ScoreArtist, false],
          [alphaTab.NotationElement.ScoreWordsAndMusic, false],
        ]),
      },
    })
    apiRef.current = api
    if (import.meta.env.DEV) {
      // 개발 콘솔 디버깅용
      ;(window as unknown as Record<string, unknown>).__api = api
      ;(window as unknown as Record<string, unknown>).__at = alphaTab
    }

    api.scoreLoaded.on((score) => {
      setTracks(
        score.tracks.map((t) => ({
          index: t.index,
          name: t.name,
          mute: false,
          solo: false,
          visible: true,
          volume: 100,
        })),
      )
      setScoreMeta({ title: score.title, artist: score.artist })
      setTuning([...(score.tracks[0]?.staves[0]?.tuning ?? [])])
      // 기본은 전 악기 풀스코어 — 사이드바에서 악기별로 좁혀볼 수 있다
      if (score.tracks.length > 1) api.renderTracks([...score.tracks])
    })
    api.renderFinished.on(() => {
      setReady(true)
      recomputeOverlay()
    })
    // 에디터: 비트 클릭 → 좌표로 노트/현 판별해 선택.
    // 풀스코어에서 어느 악기를 클릭해도 되도록, 클릭한 트랙으로 자동 전환
    api.beatMouseDown.on((beat) => {
      if (!editModeRef.current) return
      const staff = beat.voice.bar.staff
      // 현악기 트랙만 지원 (키보드/드럼은 string/fret 개념이 없음)
      if ((staff.tuning.length || 0) === 0) {
        setEditHint(`"${staff.track.name}" 트랙은 편집 미지원 (현악기 트랙만 가능)`)
        return
      }
      setEditHint(null)
      if (staff.track.index !== activeTrackRef.current) {
        setActiveTrack(staff.track.index)
        setTuning([...staff.tuning])
      }
      const bl = api.renderer.boundsLookup
      const { x, y } = lastPointerRef.current
      const note = bl?.getNoteAtPos(beat, x, y) ?? null
      const stringCount = staff.tuning.length || 6
      const string = note
        ? note.string
        : Math.min(stringCount, Math.max(1, selRef.current?.string ?? 1))
      selRef.current = { beat, string }
      setSelVersion((v) => v + 1)
    })
    api.playerStateChanged.on((e) => {
      const isPlaying = e.state === alphaTab.synth.PlayerState.Playing
      setPlaying(isPlaying)
      if (!isPlaying) setActiveNotes([])
    })
    api.activeBeatsChanged.on((e) => {
      const notes: ActiveNote[] = []
      for (const beat of e.activeBeats) {
        if (beat.voice.bar.staff.track.index !== activeTrackRef.current) continue
        for (const note of beat.notes) {
          if (note.isStringed) notes.push({ string: note.string, fret: note.fret })
        }
      }
      setActiveNotes(notes)
    })
    let lastPos = 0
    api.playerPositionChanged.on((e) => {
      const now = Date.now()
      if (now - lastPos > 250) {
        lastPos = now
        setPosition({ current: e.currentTime, end: e.endTime })
      }
    })

    if (isUploaded && upload) {
      api.load(upload.data)
    } else {
      // 서버에서 곡 메타 + 콘텐츠(최신 리비전 or 원본 tex) 로드
      Promise.all([fetchSong(slug), fetchContent(slug)])
        .then(([meta, content]) => {
          if (cancelled) return
          setSong(meta)
          setRevision(content.revision)
          if (content.type === 'tex') api.tex(content.tex)
          else api.load(fromBase64(content.b64))
        })
        .catch(() => {
          if (!cancelled) setSongError(true)
        })
    }

    // 에디터 좌표 캡처 (boundsLookup은 at-surface 기준 좌표)
    const sheetEl = sheetRef.current
    const onPointerDown = (e: MouseEvent) => {
      const surface = sheetEl?.querySelector('.at-surface')
      if (!surface) return
      const rect = surface.getBoundingClientRect()
      lastPointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    // capture 단계: alphaTab 내부 핸들러(beatMouseDown)보다 먼저 좌표를 기록해야 한다
    sheetEl?.addEventListener('mousedown', onPointerDown, true)

    return () => {
      cancelled = true
      sheetEl?.removeEventListener('mousedown', onPointerDown, true)
      if (midiReloadTimer.current) clearTimeout(midiReloadTimer.current)
      apiRef.current = null
      api.destroy()
      setSong(null)
      setSongError(false)
      setRevList(null)
      setReady(false)
      setPlaying(false)
      setTracks([])
      setActiveTrack(0)
      setSpeed(100)
      setPitch(0)
      setLoop(false)
      setMetronome(false)
      setCountIn(false)
      setFourBars(true)
      setDynamics(true)
      setZoom(80)
      setViewMode('vertical')
      setPosition({ current: 0, end: 0 })
      setScoreMeta({ title: '', artist: '' })
      setActiveNotes([])
      setTuning([])
      setAudioSource('synth')
      setSyncOffset(0)
      setSyncScale(100)
      originalAudioRef.current = null
      setEditMode(false)
      setDirty(false)
      setRevision(null)
      selRef.current = null
      setOverlayRect(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isUploaded, upload?.version, theme])

  // 원본(백킹 트랙) ↔ 신디시스 전환. 검증된 시퀀스: score.backingTrack 설정 →
  // 싱크 포인트 생성 → playerMode 전환 → updateSettings → updateSyncPoints
  const applyAudioSource = (mode: 'synth' | 'original') => {
    const api = apiRef.current
    if (!api?.score) return
    if (mode === 'original') {
      const audio = originalAudioRef.current
      if (!audio) return
      const backingTrack = new alphaTab.model.BackingTrack()
      backingTrack.rawAudioFile = audio.data
      api.score.backingTrack = backingTrack
      alphaTab.midi.MidiFileGenerator.generateSyncPoints(api.score, true)
      api.settings.player.playerMode = alphaTab.PlayerMode.EnabledBackingTrack
      api.updateSettings()
      api.updateSyncPoints()
      if (syncOffset !== 0 || syncScale !== 100) applySyncTransform(syncOffset, syncScale)
    } else {
      api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
      api.updateSettings()
    }
    setAudioSource(mode)
  }

  // 싱크 포인트 변환: 오디오 시각 = 악보 시각 × 배율 + 오프셋.
  // 모델(masterBar.syncPoints)에 Automation으로 기록한 뒤 api.updateSyncPoints()가 정식 반영 경로.
  const applySyncTransform = (offsetSec: number, scalePercent: number) => {
    const api = apiRef.current
    if (!api?.score) return
    const k = scalePercent / 100
    const offsetMs = offsetSec * 1000
    for (const mb of api.score.masterBars) mb.syncPoints = undefined
    const pts = alphaTab.midi.MidiFileGenerator.generateSyncPoints(api.score, true)
    for (const p of pts) {
      const automation = new alphaTab.model.Automation()
      automation.type = alphaTab.model.AutomationType.SyncPoint
      // 생성기의 끝 포인트(occurence -1)는 마지막 마디의 끝 위치를 뜻한다
      automation.ratioPosition = p.masterBarOccurence < 0 ? 1 : 0
      const data = new alphaTab.model.SyncPointData()
      data.barOccurence = Math.max(0, p.masterBarOccurence)
      data.millisecondOffset = offsetMs + p.synthTime * k
      automation.syncPointValue = data
      const mb = api.score.masterBars[p.masterBarIndex]
      if (!mb.syncPoints) mb.syncPoints = []
      mb.syncPoints.push(automation)
    }
    api.updateSyncPoints()
  }

  const changeSyncOffset = (v: number) => {
    const clamped = Math.min(10, Math.max(-10, v))
    setSyncOffset(clamped)
    applySyncTransform(clamped, syncScale)
  }

  const changeSyncScale = (v: number) => {
    const clamped = Math.min(120, Math.max(80, v))
    setSyncScale(clamped)
    applySyncTransform(syncOffset, clamped)
  }

  const onAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    originalAudioRef.current = { name: file.name, data: new Uint8Array(await file.arrayBuffer()) }
    e.target.value = ''
    applyAudioSource('original')
  }

  const clickOriginal = () => {
    if (originalAudioRef.current) applyAudioSource('original')
    else audioInputRef.current?.click()
  }

  // ── 에디터 동작 ──
  const recomputeOverlay = () => {
    const api = apiRef.current
    const sel = selRef.current
    if (!api || !sel || !editModeRef.current) {
      setOverlayRect(null)
      return
    }
    const bl = api.renderer.boundsLookup
    const bb = bl?.findBeat(sel.beat)
    if (!bb) {
      setOverlayRect(null)
      return
    }
    const nb = bb.notes?.find((n) => n.note.string === sel.string)
    if (nb) {
      const r = nb.noteHeadBounds
      setOverlayRect({ x: r.x - 4, y: r.y - 3, w: r.w + 8, h: r.h + 6 })
      return
    }
    // 빈 위치: 같은 마디의 노트들에서 현→y를 보간해 추정
    const pairs = new Map<number, number>()
    for (const b of sel.beat.voice.beats) {
      const bb2 = bl?.findBeat(b)
      if (!bb2?.notes) continue
      for (const n2 of bb2.notes) pairs.set(n2.note.string, n2.noteHeadBounds.y)
    }
    const vb = bb.visualBounds
    let y = vb.y + vb.h / 2 - 8
    if (pairs.size >= 2) {
      const arr = [...pairs.entries()].sort((a, b) => a[0] - b[0])
      const [s0, y0] = arr[0]
      const [s1, y1] = arr[arr.length - 1]
      y = y0 + ((y1 - y0) / (s1 - s0)) * (sel.string - s0) - 8
    } else if (pairs.size === 1) {
      const [[s0, y0]] = pairs
      y = y0 - (sel.string - s0) * 12 - 8
    }
    setOverlayRect({ x: vb.x - 2, y, w: Math.max(vb.w, 12) + 8, h: 16 })
  }

  useEffect(() => {
    recomputeOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selVersion, editMode])

  const refreshAfterEdit = (structural: boolean) => {
    const api = apiRef.current
    if (!api?.score) return
    if (structural) api.score.finish(api.settings)
    api.render()
    setDirty(true)
    if (midiReloadTimer.current) clearTimeout(midiReloadTimer.current)
    midiReloadTimer.current = setTimeout(() => apiRef.current?.loadMidiForScore(), 600)
  }

  // ── 편집 연산 + 실행취소 스택 ──
  // 모든 편집은 역연산 가능한 EditOp로 기록된다 (fret: 이전/이후 값, effect: 재토글이 역연산)
  const pushOp = (op: EditOp) => {
    undoStack.current.push(op)
    if (undoStack.current.length > 300) undoStack.current.shift()
    redoStack.current = []
  }

  const writeFret = (
    beat: alphaTab.model.Beat,
    string: number,
    fret: number | null,
    record = true,
  ) => {
    const existing = beat.notes.find((n) => n.string === string)
    if (fret === null && !existing) return
    if (record) pushOp({ kind: 'fret', beat, string, before: existing ? existing.fret : null, after: fret })
    if (fret === null) {
      beat.removeNote(existing!)
      refreshAfterEdit(true)
    } else if (existing) {
      existing.fret = fret
      refreshAfterEdit(false)
    } else {
      const note = new alphaTab.model.Note()
      note.string = string
      note.fret = fret
      beat.addNote(note)
      refreshAfterEdit(true)
    }
    setSelVersion((v) => v + 1)
  }

  const applyDigit = (d: number) => {
    const sel = selRef.current
    if (!sel) return
    const now = Date.now()
    let fret = d
    const pending = pendingDigitRef.current
    if (pending && now - pending.t < 800) {
      const combined = pending.d * 10 + d
      if (combined <= 24) fret = combined
      pendingDigitRef.current = null
    } else {
      pendingDigitRef.current = { d, t: now }
    }
    writeFret(sel.beat, sel.string, fret)
  }

  // 키패드 클릭용: 두 자리 조합 없이 바로 입력
  const setFretDirect = (fret: number) => {
    const sel = selRef.current
    if (!sel) return
    pendingDigitRef.current = null
    writeFret(sel.beat, sel.string, fret)
  }

  const deleteSelected = () => {
    const sel = selRef.current
    if (!sel) return
    writeFret(sel.beat, sel.string, null)
  }

  const setBeatDuration = (value: number, record = true) => {
    const sel = selRef.current
    if (!sel) return
    if (record) pushOp({ kind: 'duration', beat: sel.beat, before: sel.beat.duration as number, after: value })
    sel.beat.duration = value as alphaTab.model.Duration
    refreshAfterEdit(true)
    setSelVersion((v) => v + 1)
  }

  const applyEffectToggle = (
    beat: alphaTab.model.Beat,
    string: number,
    effect: NoteEffect,
  ): boolean => {
    const note = beat.notes.find((n) => n.string === string)
    if (!note) return false
    switch (effect) {
      case 'palmMute':
        note.isPalmMute = !note.isPalmMute
        break
      case 'letRing':
        note.isLetRing = !note.isLetRing
        break
      case 'vibrato':
        note.vibrato =
          note.vibrato === alphaTab.model.VibratoType.None
            ? alphaTab.model.VibratoType.Slight
            : alphaTab.model.VibratoType.None
        break
      case 'dead':
        note.isDead = !note.isDead
        break
      case 'ghost':
        note.isGhost = !note.isGhost
        break
    }
    refreshAfterEdit(true)
    setSelVersion((v) => v + 1)
    return true
  }

  const toggleNoteEffect = (effect: NoteEffect) => {
    const sel = selRef.current
    if (!sel) return
    if (applyEffectToggle(sel.beat, sel.string, effect)) {
      pushOp({ kind: 'effect', beat: sel.beat, string: sel.string, effect })
    }
  }

  const applyOp = (op: EditOp, dir: 'undo' | 'redo') => {
    if (op.kind === 'fret') {
      writeFret(op.beat, op.string, dir === 'undo' ? op.before : op.after, false)
    } else if (op.kind === 'duration') {
      op.beat.duration = (dir === 'undo' ? op.before : op.after) as alphaTab.model.Duration
      refreshAfterEdit(true)
      setSelVersion((v) => v + 1)
    } else {
      applyEffectToggle(op.beat, op.string, op.effect) // 토글 재적용 = 역연산
    }
  }

  const undoEdit = () => {
    const op = undoStack.current.pop()
    if (!op) return
    applyOp(op, 'undo')
    redoStack.current.push(op)
  }

  const redoEdit = () => {
    const op = redoStack.current.pop()
    if (!op) return
    applyOp(op, 'redo')
    undoStack.current.push(op)
  }

  const moveSelection = (key: string) => {
    const sel = selRef.current
    if (!sel) return
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const next = key === 'ArrowLeft' ? sel.beat.previousBeat : sel.beat.nextBeat
      if (next) selRef.current = { beat: next, string: sel.string }
    } else {
      const stringCount = sel.beat.voice.bar.staff.tuning.length || 6
      const delta = key === 'ArrowUp' ? 1 : -1 // 모델: 번호가 클수록 높은 현(위쪽)
      const string = Math.min(stringCount, Math.max(1, sel.string + delta))
      selRef.current = { beat: sel.beat, string }
    }
    pendingDigitRef.current = null
    setSelVersion((v) => v + 1)
  }

  const toggleEditMode = () => {
    setEditMode((prev) => {
      const next = !prev
      if (next) apiRef.current?.pause()
      else {
        selRef.current = null
        setOverlayRect(null)
        undoStack.current = []
        redoStack.current = []
      }
      return next
    })
  }

  const saveCurrentRevision = async () => {
    const api = apiRef.current
    if (!api?.score || !song) return
    const bytes = new alphaTab.exporter.Gp7Exporter().export(api.score, api.settings)
    try {
      const rev = await postRevision(song.slug, bytes)
      setRevision(rev)
      setDirty(false)
      setRevList(null)
    } catch (e) {
      if (e instanceof Error && e.message.includes('401')) {
        alert('리비전을 게시하려면 로그인이 필요합니다. 우측 상단에서 로그인하세요.')
      } else {
        alert('리비전 저장에 실패했습니다. API 서버가 실행 중인지 확인하세요.')
      }
    }
  }

  const reloadContent = async () => {
    const api = apiRef.current
    if (!api || !song) return
    const content = await fetchContent(song.slug)
    setRevision(content.revision)
    if (content.type === 'tex') api.tex(content.tex)
    else api.load(fromBase64(content.b64))
  }

  const revertToOriginal = async () => {
    if (!song) return
    try {
      await clearRevisions(song.slug)
    } catch (e) {
      if (e instanceof Error && e.message.includes('401')) {
        alert('원본으로 되돌리려면 로그인이 필요합니다.')
      }
      return
    }
    setDirty(false)
    setRevList(null)
    selRef.current = null
    setOverlayRect(null)
    await reloadContent()
  }

  const toggleRevisionList = async () => {
    if (!song) return
    if (revList) {
      setRevList(null)
      return
    }
    try {
      setRevList(await fetchRevisions(song.slug))
    } catch {
      setRevList([])
    }
  }

  const SOURCE_LABEL: Record<string, string> = {
    editor: '수동 편집',
    upload: '파일 업로드',
    ai: 'AI 생성',
  }

  const vote = async (revId: number, next: 1 | -1 | 0) => {
    try {
      const r = await voteRevision(revId, next)
      setRevList(
        (prev) =>
          prev?.map((rev) =>
            rev.id === revId ? { ...rev, score: r.score, myVote: r.myVote } : rev,
          ) ?? null,
      )
    } catch (e) {
      if (e instanceof Error && e.message.includes('401')) {
        alert('투표하려면 로그인이 필요합니다.')
      }
    }
  }

  const viewRevision = async (id: number) => {
    const api = apiRef.current
    if (!api) return
    try {
      const content = await fetchRevisionContent(id)
      api.load(fromBase64(content.b64))
      setRevision(content.revision)
      setRevList(null)
      setDirty(false)
      selRef.current = null
      setOverlayRect(null)
    } catch {
      /* 무시 */
    }
  }

  const playPause = () => apiRef.current?.playPause()
  const toBeginning = () => apiRef.current?.stop()
  const print = () =>
    apiRef.current?.print(undefined, { display: { resources: PRINT_RESOURCES } })

  // 믹서에서 특정 악기 악보만 인쇄: 잠깐 그 트랙만 렌더한 상태로 팝업을 띄우고 원상복구
  const printTrack = (index: number) => {
    const api = apiRef.current
    if (!api?.score) return
    const prev = [...api.tracks]
    api.renderTracks([api.score.tracks[index]])
    api.print(undefined, { display: { resources: PRINT_RESOURCES } })
    api.renderTracks(prev)
  }

  const downloadMidi = () => apiRef.current?.downloadMidi()

  const downloadGp = () => {
    const api = apiRef.current
    if (!api?.score) return
    const bytes = new alphaTab.exporter.Gp7Exporter().export(api.score, api.settings)
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${api.score.title || 'tab'}.gp`
    a.click()
    URL.revokeObjectURL(url)
  }

  const changeMasterVolume = (value: number) => {
    const v = Math.min(100, Math.max(0, value))
    setMasterVolume(v)
    if (apiRef.current) apiRef.current.masterVolume = v / 100
  }

  const changeSpeed = (value: number) => {
    const v = Math.min(175, Math.max(15, value))
    setSpeed(v)
    if (apiRef.current) apiRef.current.playbackSpeed = v / 100
  }

  const changePitch = (value: number) => {
    const v = Math.min(12, Math.max(-12, value))
    const api = apiRef.current
    if (!api?.score) return
    setPitch(v)
    api.changeTrackTranspositionPitch([...api.score.tracks], v)
  }

  const toggleLoop = () => {
    setLoop((prev) => {
      if (apiRef.current) apiRef.current.isLooping = !prev
      return !prev
    })
  }

  const toggleMetronome = () => {
    setMetronome((prev) => {
      if (apiRef.current) apiRef.current.metronomeVolume = prev ? 0 : 1
      return !prev
    })
  }

  const toggleCountIn = () => {
    setCountIn((prev) => {
      if (apiRef.current) apiRef.current.countInVolume = prev ? 0 : 1
      return !prev
    })
  }

  const toggleFourBars = () => {
    const api = apiRef.current
    if (!api) return
    setFourBars((prev) => {
      api.settings.display.barsPerRow = prev ? -1 : 4
      api.updateSettings()
      api.render()
      return !prev
    })
  }

  const changeZoom = (delta: number) => {
    const api = apiRef.current
    if (!api) return
    setZoom((prev) => {
      const v = Math.min(200, Math.max(50, prev + delta))
      api.settings.display.scale = v / 100
      api.updateSettings()
      api.render()
      return v
    })
  }

  // 세로 스크롤(페이지) ↔ 가로 넘김(수평 스트립)
  const changeViewMode = (mode: 'vertical' | 'horizontal') => {
    const api = apiRef.current
    if (!api) return
    setViewMode(mode)
    api.settings.display.layoutMode =
      mode === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page
    api.updateSettings()
    api.render()
  }

  // 페이지 넘김: 마디 경계에 맞춰 한 화면씩 — 잘린 마디 없이 책장 넘기듯
  const flipPage = (dir: 1 | -1) => {
    const vp = viewportRef.current
    const api = apiRef.current
    if (!vp) return
    const width = vp.clientWidth
    const left = vp.scrollLeft
    const bars = (api?.renderer.boundsLookup?.staffSystems ?? [])
      .flatMap((s) => s.bars)
      .map((b) => ({ x: b.realBounds.x, r: b.realBounds.x + b.realBounds.w }))
      .sort((a, b) => a.x - b.x)
    let target: number
    if (bars.length === 0) {
      target = left + dir * width * 0.85
    } else if (dir === 1) {
      // 다음 페이지 = 현재 화면에 다 안 들어간 첫 마디부터
      const next = bars.find((b) => b.r > left + width + 2)
      target = next ? next.x : left + width
    } else {
      // 이전 페이지 = 한 화면 왼쪽 범위에서 시작하는 첫 완전한 마디부터
      const from = Math.max(0, left - width)
      const cand = bars.find((b) => b.x >= from - 2)
      target = cand && cand.x < left - 2 ? cand.x : from
    }
    vp.scrollTo({ left: Math.max(0, target - 12), behavior: 'smooth' })
  }

  const changeNotationMode = (mode: 'both' | 'tab' | 'score') => {
    const api = apiRef.current
    if (!api) return
    setNotationMode(mode)
    api.settings.display.staveProfile =
      mode === 'tab'
        ? alphaTab.StaveProfile.Tab
        : mode === 'score'
          ? alphaTab.StaveProfile.Score
          : alphaTab.StaveProfile.Default
    api.updateSettings()
    api.render()
  }

  // Shift+←/→: 루프 오른쪽 경계를 마디 단위로 이동 (Songsterr 동일)
  const adjustLoopEnd = (dir: 1 | -1) => {
    const api = apiRef.current
    if (!api?.score) return
    const mbs = api.score.masterBars
    const last = mbs[mbs.length - 1]
    const boundaries = mbs.map((mb) => mb.start)
    boundaries.push(last.start + last.calculateDuration())

    const range = api.playbackRange
    let startTick: number
    let endIdx: number
    if (range) {
      startTick = range.startTick
      endIdx = boundaries.findIndex((b) => b >= range.endTick)
      if (endIdx < 0) endIdx = boundaries.length - 1
    } else {
      // 루프가 없으면 현재 커서 마디부터 시작
      const tick = api.tickPosition
      let barIdx = mbs.findIndex((mb) => mb.start > tick) - 1
      if (barIdx < 0) barIdx = barIdx === -2 ? mbs.length - 1 : 0
      startTick = boundaries[barIdx]
      endIdx = barIdx + 1
    }
    const startIdx = boundaries.findIndex((b) => b >= startTick)
    endIdx = Math.min(boundaries.length - 1, Math.max(startIdx + 1, endIdx + dir))
    api.playbackRange = { startTick, endTick: boundaries[endIdx] }
    if (!loop) {
      api.isLooping = true
      setLoop(true)
    }
  }

  const toggleDynamics = () => {
    const api = apiRef.current
    if (!api) return
    setDynamics((prev) => {
      api.settings.notation.elements.set(alphaTab.NotationElement.EffectDynamics, !prev)
      api.updateSettings()
      api.render()
      return !prev
    })
  }

  const toggleSidebar = () =>
    setSidebar((v) => {
      localStorage.setItem('songcopy:sidebar', v ? '0' : '1')
      return !v
    })

  const showAllTracks = () => {
    const api = apiRef.current
    if (!api?.score) return
    setTracks((prev) => prev.map((t) => ({ ...t, visible: true })))
    api.renderTracks([...api.score.tracks])
  }

  const selectTrack = (index: number) => {
    const api = apiRef.current
    if (!api?.score) return
    const track = api.score.tracks[index]
    if (!track) return
    setActiveTrack(index)
    setTuning([...(track.staves[0]?.tuning ?? [])])
    setActiveNotes([])
    setTracks((prev) => prev.map((t) => ({ ...t, visible: t.index === index })))
    api.renderTracks([track])
  }

  // 멀티트랙 동시 보기: 체크된 트랙들을 함께 렌더 (Songsterr "Add to multi-track")
  const toggleMultiTrack = (index: number) => {
    const api = apiRef.current
    if (!api?.score) return
    setTracks((prev) => {
      const next = prev.map((t) => (t.index === index ? { ...t, visible: !t.visible } : t))
      const visible = next.filter((t) => t.visible)
      if (visible.length === 0) return prev // 최소 1개는 유지
      api.renderTracks(visible.map((t) => api.score!.tracks[t.index]))
      return next
    })
  }

  const toggleMute = (index: number) => {
    const api = apiRef.current
    if (!api?.score) return
    setTracks((prev) =>
      prev.map((t) => {
        if (t.index !== index) return t
        api.changeTrackMute([api.score!.tracks[index]], !t.mute)
        return { ...t, mute: !t.mute }
      }),
    )
  }

  const changeTrackVol = (index: number, value: number) => {
    const api = apiRef.current
    if (!api?.score) return
    const v = Math.min(150, Math.max(0, value))
    api.changeTrackVolume([api.score.tracks[index]], v / 100)
    setTracks((prev) => prev.map((t) => (t.index === index ? { ...t, volume: v } : t)))
  }

  const toggleSolo = (index: number) => {
    const api = apiRef.current
    if (!api?.score) return
    setTracks((prev) =>
      prev.map((t) => {
        if (t.index !== index) return t
        api.changeTrackSolo([api.score!.tracks[index]], !t.solo)
        return { ...t, solo: !t.solo }
      }),
    )
  }

  // 키보드 단축키 (Songsterr 호환)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.shiftKey && e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5))
        if (n >= 1 && n <= 8) {
          e.preventDefault()
          changeSpeed(SPEED_PRESETS[n - 1])
          return
        }
      }
      // Shift+A/D: 속도 미세 조정 (Songsterr는 BPM ±1, 여기서는 ±1%)
      if (e.shiftKey && (e.code === 'KeyA' || e.code === 'KeyD')) {
        e.preventDefault()
        changeSpeed(speed + (e.code === 'KeyD' ? 1 : -1))
        return
      }
      // Shift+←/→: 루프 경계 이동
      if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        adjustLoopEnd(e.key === 'ArrowRight' ? 1 : -1)
        return
      }

      // 편집 모드: 실행취소/다시실행 (선택 없어도 동작)
      if (editMode && (e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redoEdit()
        else undoEdit()
        return
      }
      // 편집 모드 전용 키
      if (editMode && selRef.current) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault()
          applyDigit(Number(e.key))
          return
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          deleteSelected()
          return
        }
        if (e.key.startsWith('Arrow')) {
          e.preventDefault()
          moveSelection(e.key)
          return
        }
      }
      if (e.key === 'e' || e.key === 'E') {
        toggleEditMode()
        return
      }

      switch (e.key) {
        case ' ':
          e.preventDefault()
          playPause()
          break
        case 'Backspace':
          e.preventDefault()
          toBeginning()
          break
        case 'n':
        case 'N':
          if (!isOriginal) toggleMetronome()
          break
        case 'c':
        case 'C':
          if (!isOriginal) toggleCountIn()
          break
        case 'v':
        case 'V':
          if (isOriginal) applyAudioSource('synth')
          else clickOriginal()
          break
        case 'l':
        case 'L':
          toggleLoop()
          break
        case 's':
        case 'S':
          openSideTab('play')
          break
        case 't':
        case 'T':
          toggleSidebar()
          break
        case 'r':
        case 'R':
          if (!isOriginal) openSideTab('play')
          break
        case 'f':
        case 'F':
          setShowFretboard((v) => !v)
          break
        case 'm':
        case 'M':
          if (isOriginal) break
          if (e.altKey) toggleSolo(activeTrack)
          else toggleMute(activeTrack)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack, isOriginal, editMode, speed, loop])

  if (songError) {
    return (
      <div className="song-missing">
        <p>곡을 찾을 수 없거나 API 서버에 연결할 수 없습니다.</p>
        <Link to="/">홈으로</Link>
      </div>
    )
  }

  if (isUploaded && !upload) {
    return (
      <div className="song-missing">
        <p>열려 있는 업로드 파일이 없습니다. (새로고침하면 업로드가 사라집니다)</p>
        <OpenFileButton className="upload-btn">📄 Guitar Pro 파일 열기</OpenFileButton>
      </div>
    )
  }

  const active = tracks[activeTrack]
  const isFavorite = song ? favorites.includes(song.slug) : false
  const title = song ? song.title : scoreMeta.title || upload?.name || ''
  const artist = song ? song.artist : scoreMeta.artist

  // 지판/에디터 스트립이 열려 있으면 하단 패널들을 그 높이만큼 위로 올린다
  // 편집 모드 스트립은 키패드 포함 두 줄 정도 높이
  const fretboardHeight = (showFretboard ? tuning.length * 22 + 62 : 0) + (editMode ? 96 : 0)

  const sel = selRef.current
  const selNote = editMode && sel ? sel.beat.notes.find((n) => n.string === sel.string) : undefined
  const selInfo =
    editMode && sel
      ? {
          bar: sel.beat.voice.bar.index + 1,
          string: sel.string,
          fret: selNote?.fret ?? null,
          duration: sel.beat.duration as number,
        }
      : null
  void selVersion

  return (
    <div
      className="song-page"
      style={{ '--fb-h': `${fretboardHeight}px` } as React.CSSProperties}
    >
      <div className="song-body">
        {sidebar && (
          <aside className="side-panel">
            <div className="side-tabs">
              {(
                [
                  ['mixer', '믹서'],
                  ['play', '재생'],
                  ['settings', '설정'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={`side-tab ${sideTab === k ? 'on' : ''}`}
                  onClick={() => setSideTab(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            {sideTab === 'mixer' && (
            <div className="side-section">
              <div className="side-head">
                <span className="panel-title">믹서</span>
                <button className="chip" onClick={showAllTracks} title="전 악기 풀스코어 보기">
                  모두 보기
                </button>
              </div>
              {tracks.map((t) => (
                <div key={t.index} className={`track-row ${t.index === activeTrack ? 'active' : ''}`}>
                  <span className="track-icon">
                    <Icon name={trackIconName(t.name)} />
                  </span>
                  <button
                    className="track-name"
                    onClick={() => selectTrack(t.index)}
                    title="이 트랙 악보만 보기"
                  >
                    {t.name}
                  </button>
                  <button
                    className={`chip ${t.solo ? 'on' : ''}`}
                    onClick={() => toggleSolo(t.index)}
                    disabled={isOriginal}
                    title="솔로 — 이 악기만 듣기"
                  >
                    S
                  </button>
                  <button
                    className={`chip ${t.mute ? 'on' : ''}`}
                    onClick={() => toggleMute(t.index)}
                    disabled={isOriginal}
                    title="뮤트"
                  >
                    M
                  </button>
                  <button
                    className={`chip ${t.visible ? 'on' : ''}`}
                    onClick={() => toggleMultiTrack(t.index)}
                    title="악보에 표시 (여러 개 켜면 동시 보기)"
                  >
                    <Icon name="eye" />
                  </button>
                  <button className="chip" onClick={() => printTrack(t.index)} title="이 악기 악보만 인쇄">
                    <Icon name="print" />
                  </button>
                  <input
                    className="track-vol side-vol"
                    type="range"
                    min={0}
                    max={150}
                    value={t.volume}
                    disabled={isOriginal}
                    onChange={(e) => changeTrackVol(t.index, Number(e.target.value))}
                    title={`볼륨 ${t.volume}%`}
                  />
                </div>
              ))}
              {song?.lyrics && (
                <div className="track-row">
                  <span className="track-icon">
                    <Icon name="mic" />
                  </span>
                  <span className="track-name">가사</span>
                  <button
                    className={`chip ${showLyrics ? 'on' : ''}`}
                    onClick={() => setShowLyrics((v) => !v)}
                    title="가사 표시/숨김"
                  >
                    <Icon name="eye" />
                  </button>
                </div>
              )}
              <p className="panel-note">S 솔로 · M 뮤트 · 눈 = 악보 표시 · 프린터 = 인쇄 · 슬라이더 = 볼륨</p>
            </div>
            )}
            {sideTab === 'play' && (
              <>
                <div className="side-section">
                  <span className="panel-title">재생 속도: {speed}%</span>
                  <input
                    type="range"
                    min={15}
                    max={175}
                    step={5}
                    value={speed}
                    onChange={(e) => changeSpeed(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--green)' }}
                  />
                  <div className="speed-presets">
                    {SPEED_PRESETS.map((p) => (
                      <button
                        key={p}
                        className={`chip ${speed === p ? 'on' : ''}`}
                        onClick={() => changeSpeed(p)}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                  <p className="panel-note">Shift+1~8 프리셋 · Shift+A/D ±1%</p>
                </div>
                <div className="side-section">
                  <span className="panel-title">재생 보조</span>
                  <div className="speed-presets">
                    <button className={`chip ${loop ? 'on' : ''}`} onClick={toggleLoop} title="루프 (L)">
                      <Icon name="loop" /> 루프
                    </button>
                    <button
                      className={`chip ${countIn ? 'on' : ''}`}
                      onClick={toggleCountIn}
                      disabled={isOriginal}
                      title="카운트인 (C)"
                    >
                      카운트인
                    </button>
                    <button
                      className={`chip ${metronome ? 'on' : ''}`}
                      onClick={toggleMetronome}
                      disabled={isOriginal}
                      title="메트로놈 (N)"
                    >
                      <Icon name="metronome" /> 메트로놈
                    </button>
                    <button
                      className={`chip ${showFretboard ? 'on' : ''}`}
                      onClick={() => setShowFretboard((v) => !v)}
                      title="지판 (F)"
                    >
                      <Icon name="fretboard" /> 지판
                    </button>
                  </div>
                </div>
                <div className="side-section">
                  <span className="panel-title">피치 시프트</span>
                  <div className="pitch-stepper">
                    <button
                      className="chip"
                      onClick={() => changePitch(pitch - 1)}
                      disabled={isOriginal || pitch <= -12}
                    >
                      −
                    </button>
                    <span className="pitch-value">{pitch > 0 ? `+${pitch}` : pitch} 반음</span>
                    <button
                      className="chip"
                      onClick={() => changePitch(pitch + 1)}
                      disabled={isOriginal || pitch >= 12}
                    >
                      +
                    </button>
                    <button className="chip" onClick={() => changePitch(0)} disabled={pitch === 0}>
                      초기화
                    </button>
                  </div>
                </div>
                {isOriginal && (
                  <div className="side-section">
                    <span className="panel-title">원본 오디오 싱크</span>
                    <div className="sync-row">
                      <span className="sync-label">오프셋: {syncOffset.toFixed(2)}초</span>
                      <input
                        type="range"
                        min={-10}
                        max={10}
                        step={0.05}
                        value={syncOffset}
                        onChange={(e) => changeSyncOffset(Number(e.target.value))}
                      />
                    </div>
                    <div className="sync-row">
                      <span className="sync-label">템포 배율: {syncScale.toFixed(1)}%</span>
                      <input
                        type="range"
                        min={80}
                        max={120}
                        step={0.1}
                        value={syncScale}
                        onChange={(e) => changeSyncScale(Number(e.target.value))}
                      />
                    </div>
                    <div className="speed-presets">
                      <button
                        className="chip"
                        onClick={() => {
                          changeSyncOffset(0)
                          changeSyncScale(100)
                        }}
                      >
                        초기화
                      </button>
                    </div>
                  </div>
                )}
                <div className="side-section">
                  <span className="panel-title">마스터 볼륨: {masterVolume}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={masterVolume}
                    onChange={(e) => changeMasterVolume(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--green)' }}
                  />
                </div>
              </>
            )}
            {sideTab === 'settings' && (
              <>
            <div className="side-section">
              <span className="panel-title">표기</span>
              <div className="speed-presets">
                {(
                  [
                    ['both', '탭+오선'],
                    ['tab', '탭만'],
                    ['score', '오선만'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={`chip ${notationMode === mode ? 'on' : ''}`}
                    onClick={() => changeNotationMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="panel-title" style={{ display: 'block', marginTop: 12 }}>
                보기 방식
              </span>
              <div className="speed-presets">
                <button
                  className={`chip ${viewMode === 'vertical' ? 'on' : ''}`}
                  onClick={() => changeViewMode('vertical')}
                >
                  세로 스크롤
                </button>
                <button
                  className={`chip ${viewMode === 'horizontal' ? 'on' : ''}`}
                  onClick={() => changeViewMode('horizontal')}
                >
                  가로 넘김
                </button>
              </div>
            </div>
            <div className="side-section">
              <span className="panel-title">내보내기</span>
              <div className="speed-presets">
                <button className="chip" onClick={print}>
                  <Icon name="print" /> 인쇄
                </button>
                <button className="chip" onClick={downloadMidi}>
                  <Icon name="download" /> MIDI
                </button>
                <button className="chip" onClick={downloadGp}>
                  <Icon name="download" /> .gp
                </button>
              </div>
            </div>
            <div className="side-section">
              <span className="panel-title">설정</span>
              <label className="setting-row">
                <input type="checkbox" checked={fourBars} onChange={toggleFourBars} />한 줄에 4마디
              </label>
              <label className="setting-row">
                <input type="checkbox" checked={dynamics} onChange={toggleDynamics} />강약 기호 표시
              </label>
              <label className="setting-row">
                <input
                  type="checkbox"
                  checked={theme === 'dark'}
                  onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                />
                다크 모드
              </label>
            </div>
              </>
            )}
          </aside>
        )}
        <div className="sheet-area">
        <div className="sheet-viewport" ref={viewportRef}>
        <header className="song-head">
          <h1 className="song-title">{title} 탭</h1>
          <div className="song-meta">
            {song && (
              <button
                className={`icon-btn fav ${isFavorite ? 'on' : ''}`}
                onClick={() => toggleFavorite(song.slug)}
                title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
              >
                {isFavorite ? '★' : '☆'}
              </button>
            )}
            {song ? (
              <span className="rev-anchor">
                <button className="rev-toggle" onClick={toggleRevisionList} title="리비전 목록">
                  수정 날짜:{' '}
                  {revision ? `${formatRevDate(revision.date)} (리비전 #${revision.id})` : song.seedDate}
                  {song.revisionCount > 0 && ' ▾'}
                </button>
                {revList && (
                  <span className="rev-list">
                    <span className="panel-title">리비전 목록</span>
                    {revList.length === 0 && <span className="rev-empty">저장된 리비전 없음</span>}
                    {revList.map((r) => (
                      <span key={r.id} className={`rev-item ${revision?.id === r.id ? 'on' : ''}`}>
                        <button className="rev-item-main" onClick={() => viewRevision(r.id)}>
                          #{r.id} · {formatRevDate(r.date)}
                          {r.author ? ` · ${r.author}` : ''}
                          <span className="rev-source">{SOURCE_LABEL[r.source ?? ''] ?? ''}</span>
                        </button>
                        <span className="rev-vote">
                          <button
                            className={`vote-btn ${r.myVote === 1 ? 'on' : ''}`}
                            onClick={() => vote(r.id, r.myVote === 1 ? 0 : 1)}
                            title="정확해요"
                          >
                            👍
                          </button>
                          <span className={`vote-score ${(r.score ?? 0) < 0 ? 'neg' : ''}`}>
                            {r.score ?? 0}
                          </span>
                          <button
                            className={`vote-btn ${r.myVote === -1 ? 'on' : ''}`}
                            onClick={() => vote(r.id, r.myVote === -1 ? 0 : -1)}
                            title="부정확해요"
                          >
                            👎
                          </button>
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            ) : (
              <span>업로드한 파일</span>
            )}
            <button className="icon-btn" onClick={print} title="인쇄">
              🖨
            </button>
          </div>
          {artist && <div className="song-artist">{artist}</div>}
        </header>
        {!ready && <div className="sheet-loading">악보 불러오는 중…</div>}
        <div className="sheet-wrap">
          <div className={`sheet ${editMode ? 'editing' : ''}`} ref={sheetRef} />
          {editMode && overlayRect && (
            <div
              className="edit-cursor"
              style={{
                left: overlayRect.x,
                top: overlayRect.y,
                width: overlayRect.w,
                height: overlayRect.h,
              }}
            />
          )}
        </div>
        <div className="sheet-hint">
          악보를 드래그하면 구간이 선택되고, 루프(L)로 반복 연습할 수 있습니다.
        </div>
        {song?.lyrics && showLyrics && (
          <details className="lyrics" open>
            <summary>🎤 가사 (AI 추출)</summary>
            <pre>{song.lyrics}</pre>
          </details>
        )}
        {song && <Comments slug={song.slug} />}
        </div>
        <div className="zoom-ctl">
          <button onClick={() => changeZoom(-10)} title="축소" disabled={zoom <= 50}>
            −
          </button>
          <span>{zoom}%</span>
          <button onClick={() => changeZoom(10)} title="확대" disabled={zoom >= 200}>
            +
          </button>
        </div>
        {viewMode === 'horizontal' && (
          <>
            <button className="page-flip left" onClick={() => flipPage(-1)} title="이전 페이지">
              ‹
            </button>
            <button className="page-flip right" onClick={() => flipPage(1)} title="다음 페이지">
              ›
            </button>
          </>
        )}
        </div>
      </div>


      {editMode && (
        <div className="editor-strip">
          <div className="editor-help">
            <b>편집 모드</b>
            {editHint && <span className="editor-dirty">{editHint}</span>}
            {!selInfo && !editHint && (
              <span>악보에서 아무 악기의 노트(또는 빈 자리)를 클릭하면 편집 도구가 나타나요</span>
            )}
            {selInfo && (
              <span className="editor-sel">
                마디 {selInfo.bar} · {selInfo.string}번 현
                {selInfo.fret !== null ? ` · ${selInfo.fret}프렛` : ' · (비어 있음)'}
              </span>
            )}
            {selInfo && (
              <span className="editor-move">
                <button className="chip" onClick={() => moveSelection('ArrowLeft')} title="이전 비트 (←)">
                  ◀
                </button>
                <button className="chip" onClick={() => moveSelection('ArrowRight')} title="다음 비트 (→)">
                  ▶
                </button>
                <button className="chip" onClick={() => moveSelection('ArrowUp')} title="윗줄 현 (↑)">
                  ▲
                </button>
                <button className="chip" onClick={() => moveSelection('ArrowDown')} title="아랫줄 현 (↓)">
                  ▼
                </button>
              </span>
            )}
            <span className="editor-move">
              <button
                className="chip"
                onClick={undoEdit}
                disabled={undoStack.current.length === 0}
                title="실행취소 (Ctrl+Z)"
              >
                ↩ 취소
              </button>
              <button
                className="chip"
                onClick={redoEdit}
                disabled={redoStack.current.length === 0}
                title="다시실행 (Ctrl+Shift+Z)"
              >
                ↪
              </button>
            </span>
            {dirty && <span className="editor-dirty">● 저장 안 됨</span>}
          </div>
          {selInfo && (
            <div className="editor-fretpad">
              <span className="editor-tools-label">프렛</span>
              {Array.from({ length: 25 }, (_, n) => (
                <button
                  key={n}
                  className={`fret-btn ${selInfo.fret === n ? 'on' : ''}`}
                  onClick={() => setFretDirect(n)}
                >
                  {n}
                </button>
              ))}
              <button
                className="fret-btn del"
                onClick={deleteSelected}
                disabled={selInfo.fret === null}
                title="노트 삭제 (Del)"
              >
                ×
              </button>
            </div>
          )}
          {selInfo && (
            <div className="editor-tools">
              <span className="editor-tools-label">음길이</span>
              {[
                [2, '2분'],
                [4, '4분'],
                [8, '8분'],
                [16, '16분'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={`chip ${selInfo.duration === v ? 'on' : ''}`}
                  onClick={() => setBeatDuration(Number(v))}
                >
                  {label}
                </button>
              ))}
              {selNote && (
                <>
                  <span className="editor-tools-label">주법</span>
                  <button
                    className={`chip ${selNote.isPalmMute ? 'on' : ''}`}
                    onClick={() => toggleNoteEffect('palmMute')}
                    title="팜뮤트"
                  >
                    P.M.
                  </button>
                  <button
                    className={`chip ${selNote.isLetRing ? 'on' : ''}`}
                    onClick={() => toggleNoteEffect('letRing')}
                    title="렛링"
                  >
                    Ring
                  </button>
                  <button
                    className={`chip ${selNote.vibrato !== alphaTab.model.VibratoType.None ? 'on' : ''}`}
                    onClick={() => toggleNoteEffect('vibrato')}
                    title="비브라토"
                  >
                    〜
                  </button>
                  <button
                    className={`chip ${selNote.isDead ? 'on' : ''}`}
                    onClick={() => toggleNoteEffect('dead')}
                    title="데드 노트"
                  >
                    ×
                  </button>
                  <button
                    className={`chip ${selNote.isGhost ? 'on' : ''}`}
                    onClick={() => toggleNoteEffect('ghost')}
                    title="고스트 노트"
                  >
                    ( )
                  </button>
                </>
              )}
            </div>
          )}
          <div className="editor-actions">
            {song && (
              <button className="chip" onClick={saveCurrentRevision} disabled={!dirty}>
                리비전 저장
              </button>
            )}
            {song && revision && (
              <button className="chip" onClick={revertToOriginal}>
                원본으로 되돌리기
              </button>
            )}
            <button className="chip" onClick={toggleEditMode}>
              닫기 (E)
            </button>
          </div>
        </div>
      )}

      {showFretboard && (
        <div className="fretboard-strip">
          <div className="fretboard-head">
            <span className="panel-title">지판 — {active?.name ?? ''}</span>
            <label className="setting-row">
              <input
                type="checkbox"
                checked={leftHanded}
                onChange={() => setLeftHanded((v) => !v)}
              />
              왼손잡이
            </label>
          </div>
          <Fretboard tuning={tuning} active={activeNotes} leftHanded={leftHanded} />
        </div>
      )}

      <footer className="player-bar">
        <button
          className={`pb-track ${sidebar ? 'on' : ''}`}
          onClick={toggleSidebar}
          title="트랙 (T)"
        >
          <span className="pb-track-name">{active ? active.name : '트랙'}</span>
          <span className="pb-track-caret">^</span>
        </button>
        <button className="pb-play" onClick={playPause} title="재생/일시정지 (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="pb-source" title="오디오 소스 전환 (V) — 원본은 오디오 파일 업로드">
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.mp3,.ogg,.wav,.m4a"
            style={{ display: 'none' }}
            onChange={onAudioFile}
          />
          <button
            className={`pb-source-seg ${isOriginal ? 'on' : ''}`}
            onClick={clickOriginal}
            title={
              originalAudioRef.current
                ? `원본: ${originalAudioRef.current.name}`
                : '오디오 파일(mp3/ogg/wav)을 열어 원본 재생'
            }
          >
            원본
          </button>
          <button
            className={`pb-source-seg ${!isOriginal ? 'on' : ''}`}
            onClick={() => applyAudioSource('synth')}
          >
            신디시스
          </button>
        </div>
        <div className="pb-time">
          {formatTime(position.current)} / {formatTime(position.end)}
        </div>
        <button
          className="pb-btn"
          onClick={() => openSideTab('play')}
          title="재생 설정 — 속도/루프/피치 (S)"
        >
          <span className="pb-icon">
            <Icon name="speed" size={18} />
          </span>
          <span>{speed}%</span>
        </button>
        <button
          className={`pb-btn ${editMode ? 'on' : ''}`}
          onClick={toggleEditMode}
          title="편집기 (E)"
        >
          <span className="pb-icon">
            <Icon name="pencil" size={18} />
          </span>
          <span>편집기</span>
        </button>
      </footer>
    </div>
  )
}
