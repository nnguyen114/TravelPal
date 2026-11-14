import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { CreateTripDialog, Modal } from '../dialogs'
import { Logo, PlusIcon } from '../icons'
import { formatRange } from '../trip'
import type { TripSummary } from '../types'

const COVERS = [
  { bg: '#E2F3F0', sun: '#FFD66B', hill: '#9FD4CB', front: '#5DB7AA' },
  { bg: '#FDEBE4', sun: '#FFFFFF', hill: '#F6B49E', front: '#EE8B6B' },
  { bg: '#ECEAFD', sun: '#FFD66B', hill: '#BDB4F7', front: '#8F82F0' },
]

function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user, deleteAccount } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Your account" onClose={onClose}>
      <p className="muted">{user?.displayName} · {user?.email}</p>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          try {
            await deleteAccount(password)
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 800 }}>Delete account</h3>
        <p className="muted">
          This removes your account, your saved places and your "not interested" list. Trips you share go to another
          member; trips only you are in are deleted. This can't be undone.
        </p>
        <label className="field">Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div role="alert" className="error">{error}</div>}
        <button className="btn btn-danger" type="submit">Delete my account</button>
      </form>
    </Modal>
  )
}

export function TopBar() {
  const { user, logout } = useAuth()
  const [account, setAccount] = useState(false)
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand"><Logo /> TravelPal</Link>
        <div className="row">
          <button className="avatar" aria-label="Your account" onClick={() => setAccount(true)}>{user?.displayName.slice(0, 1).toUpperCase()}</button>
          <button className="btn btn-ghost" onClick={logout}>Log out</button>
          {account && <AccountDialog onClose={() => setAccount(false)} />}
        </div>
      </div>
    </header>
  )
}

function TripCard({ trip, i }: { trip: TripSummary; i: number }) {
  const c = COVERS[i % COVERS.length]
  return (
    <article className="card" style={{ borderRadius: 22, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 150, background: c.bg, position: 'relative' }}>
        <svg viewBox="0 0 300 150" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
          <circle cx="230" cy="44" r="26" fill={c.sun} />
          <path d="M0 120 L70 62 L120 104 L170 70 L240 118 L300 90 L300 150 L0 150 Z" fill={c.hill} />
          <path d="M0 150 L0 132 C 80 116, 170 146, 300 124 L300 150 Z" fill={c.front} />
        </svg>
        <span style={{ position: 'absolute', left: 14, top: 14, background: 'rgba(255,255,255,.92)', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 700 }}>
          {trip.role === 'OWNER' ? 'Created by you' : 'Joined'}
        </span>
      </div>
      <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{trip.name}</h2>
        <div style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 500 }}>{trip.cities.join(' · ')}</div>
        <div className="muted" style={{ display: 'flex', gap: 14, fontSize: 13, fontWeight: 600, marginTop: 4 }}>
          <span>{formatRange(trip.startDate, trip.endDate)}</span>
          <span>{trip.memberCount} {trip.memberCount === 1 ? 'member' : 'members'}</span>
        </div>
        <Link to={`/trips/${trip.id}`} aria-label={`Open ${trip.name}`} className="btn"
          style={{ marginTop: 'auto', background: 'var(--accent-soft)', border: 0, color: 'var(--accent-ink)' }}>Open Trip</Link>
      </div>
    </article>
  )
}

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // A city picked on the landing page arrives as ?to=City (through sign-up): open Create Trip with it filled in.
  const [params] = useSearchParams()
  const [destination] = useState(() => params.get('to')?.trim().slice(0, 120) ?? '')
  const [creating, setCreating] = useState(!!destination)
  useEffect(() => {
    if (params.has('to')) navigate('/', { replace: true })
  }, [params, navigate])
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api<TripSummary[]>('/api/trips') })

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="spread" style={{ alignItems: 'flex-end', gap: 20 }}>
          <div>
            <p className="muted" style={{ margin: 0, fontWeight: 600 }}>Hi {user?.displayName}, where to next?</p>
            <h1 style={{ fontSize: 40, fontWeight: 800, marginTop: 6 }}>My Trips</h1>
          </div>
          <button className="btn btn-primary" style={{ minHeight: 48, borderRadius: 14 }} onClick={() => setCreating(true)}>
            <PlusIcon /> Create Trip
          </button>
        </div>
        {trips.error && <div role="alert" className="error" style={{ marginTop: 24 }}>{trips.error.message}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24, marginTop: 36 }}>
          {trips.data?.map((t, i) => <TripCard key={t.id} trip={t} i={i} />)}
          <button onClick={() => setCreating(true)}
            style={{ minHeight: 330, borderRadius: 22, border: '2px dashed var(--line-2)', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink-2)', fontSize: 15, fontWeight: 700 }}>
            <span style={{ width: 52, height: 52, borderRadius: '50%', background: '#fff', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PlusIcon size={22} color="#0E7C74" />
            </span>
            Start a new trip
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>Name, one destination, dates. That is it.</span>
          </button>
        </div>
      </main>
      {creating && <CreateTripDialog destination={destination} onClose={() => setCreating(false)} />}
    </>
  )
}
