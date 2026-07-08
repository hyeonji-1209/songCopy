import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import MyTabs from './pages/MyTabs'
import SongPage from './pages/SongPage'
import AuthModal from './components/AuthModal'
import HelpModal from './components/HelpModal'
import NewTabMenu from './components/NewTabMenu'
import { signout, useUser } from './lib/auth'
import { syncFavoritesWithServer } from './lib/favorites'
import { useTheme } from './lib/theme'

export default function App() {
  const [showHelp, setShowHelp] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const user = useUser()
  useTheme() // 저장된 테마를 문서에 적용

  useEffect(() => {
    if (user) void syncFavoritesWithServer()
  }, [user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <nav className="top-nav">
        <Link to="/" className="logo">
          <span className="logo-mark">🎸</span> songCopy
        </Link>
        <div className="top-nav-right">
          <Link to="/" className="nav-item">
            <span className="nav-icon">🔍</span>검색
          </Link>
          <Link to="/mytabs" className="nav-item">
            <span className="nav-icon">☆</span>내 타브
          </Link>
          <NewTabMenu />
          <button className="nav-item nav-button" onClick={() => setShowHelp(true)}>
            <span className="nav-icon">❔</span>도움말
          </button>
          {user ? (
            <button
              className="nav-item nav-button"
              onClick={() => void signout()}
              title={`${user.email} — 로그아웃`}
            >
              <span className="nav-icon">👤</span>
              {user.name}
            </button>
          ) : (
            <button className="nav-item nav-button" onClick={() => setShowAuth(true)}>
              <span className="nav-icon">→</span>로그인
            </button>
          )}
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/mytabs" element={<MyTabs />} />
        <Route path="/tab/:slug" element={<SongPage />} />
      </Routes>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  )
}
