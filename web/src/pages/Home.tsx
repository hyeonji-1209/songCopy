import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchSongs, type SongMeta } from '../lib/api'
import OpenFileButton from '../components/OpenFileButton'

export default function Home() {
  const [query, setQuery] = useState('')
  const [songs, setSongs] = useState<SongMeta[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      fetchSongs(query.trim())
        .then((s) => {
          if (!cancelled) {
            setSongs(s)
            setError(false)
          }
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  return (
    <div className="home">
      <h1 className="home-hero">
        리듬이 살아있는 기타 탭<span className="home-hero-accent">.</span>
      </h1>
      <p className="home-sub">악보를 재생하고, 커서를 따라 연주하세요.</p>
      <input
        className="home-search"
        type="search"
        placeholder="곡 또는 아티스트 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="song-list">
        {error && (
          <li className="song-empty">
            서버에 연결할 수 없습니다. <code>cd server && npm run dev</code>로 API 서버를
            실행하세요.
          </li>
        )}
        {songs?.map((s) => (
          <li key={s.slug}>
            <Link className="song-row" to={`/tab/${s.slug}`}>
              <span className="song-row-title">{s.title}</span>
              <span className="song-row-artist">{s.artist}</span>
              <span className="song-row-tags">
                {s.revisionCount > 0 && <span className="tag rev">리비전 {s.revisionCount}</span>}
                {s.instruments.map((i) => (
                  <span className="tag" key={i}>
                    {i}
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
        {songs !== null && songs.length === 0 && !error && (
          <li className="song-empty">검색 결과가 없습니다.</li>
        )}
      </ul>
      <div className="home-upload">
        <OpenFileButton className="upload-btn">📄 Guitar Pro / MusicXML 파일 열기</OpenFileButton>
        <p className="home-upload-note">
          .gp .gp3 .gp4 .gp5 .gpx .musicxml 파일을 플레이어로 바로 열 수 있습니다.
        </p>
      </div>
    </div>
  )
}
