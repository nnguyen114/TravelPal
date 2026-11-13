import { useAuth } from '../auth'
import { Logo } from '../icons'

export function TopBar() {
  const { user, logout } = useAuth()
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a href="/" className="brand"><Logo /> TravelPal</a>
        <div className="row">
          <span className="muted" style={{ fontSize: 14 }}>{user?.displayName}</span>
          <button className="btn btn-ghost" onClick={logout}>Log out</button>
        </div>
      </div>
    </header>
  )
}

export function Dashboard() {
  const { user } = useAuth()
  return (
    <>
      <TopBar />
      <main className="page">
        <p className="muted" style={{ margin: 0, fontWeight: 600 }}>Hi {user?.displayName}, where to next?</p>
        <h1 style={{ fontSize: 40, fontWeight: 800, marginTop: 6 }}>My Trips</h1>
      </main>
    </>
  )
}
