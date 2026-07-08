import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchSongs, type SongMeta } from '../lib/api'
import { useFavorites } from '../lib/favorites'

export default function MyTabs() {
  const favs = useFavorites()
  const [songs, setSongs] = useState<SongMeta[]>([])

  useEffect(() => {
    fetchSongs()
      .then(setSongs)
      .catch(() => setSongs([]))
  }, [])

  const favSongs = songs.filter((s) => favs.includes(s.slug))

  return (
    <div className="home">
      <h1 className="home-hero">
        내 타브<span className="home-hero-accent">.</span>
      </h1>
      <p className="home-sub">즐겨찾기한 곡 목록입니다.</p>
      <ul className="song-list">
        {favSongs.map((s) => (
          <li key={s.slug}>
            <Link className="song-row" to={`/tab/${s.slug}`}>
              <span className="song-row-title">{s.title}</span>
              <span className="song-row-artist">{s.artist}</span>
              <span className="song-row-tags">
                {s.instruments.map((i) => (
                  <span className="tag" key={i}>
                    {i}
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
        {favSongs.length === 0 && (
          <li className="song-empty">
            아직 즐겨찾기한 곡이 없습니다. 곡 페이지에서 ⭐ 버튼을 눌러 추가하세요.
          </li>
        )}
      </ul>
    </div>
  )
}
