import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { CreateTripDialog, Modal, PasswordInput } from '../dialogs'
import { LeaveIcon, Logo, PlusIcon, TrashIcon } from '../icons'
import { TripCover } from '../art'
import { countdown, formatRange } from '../trip'
import type { TripSummary } from '../types'


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
        <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
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

function TripCard({ trip, today, onRemove }: { trip: TripSummary; today: Date; onRemove: () => void }) {
  const owner = trip.role === 'OWNER'
  return (
    <article className="card trip-card">
      <div style={{ height: 150, position: 'relative', overflow: 'hidden' }}>
        <TripCover seed={trip.id} />
        <span className="trip-badge">{trip.role === 'OWNER' ? 'Created by you' : 'Joined'}</span>
        <span className="trip-badge trip-when">{countdown(trip.startDate, trip.endDate, today)}</span>
      </div>
      <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{trip.name}</h2>
        <div style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 500 }}>{trip.cities.join(' · ')}</div>
        <div className="muted" style={{ display: 'flex', gap: 14, fontSize: 13, fontWeight: 600, marginTop: 4 }}>
          <span>{formatRange(trip.startDate, trip.endDate)}</span>
          <span>{trip.memberCount} {trip.memberCount === 1 ? 'member' : 'members'}</span>
        </div>
        <div className="row" style={{ marginTop: 'auto', flexWrap: 'nowrap', gap: 8 }}>
          <Link to={`/trips/${trip.id}`} aria-label={`Open ${trip.name}`} className="btn open-trip"
            style={{ flex: 1, background: 'var(--accent-soft)', border: 0, color: 'var(--accent-ink)' }}>Open trip <span className="arrow" aria-hidden="true">→</span></Link>
          <button className="icon-btn" aria-label={`${owner ? 'Delete' : 'Leave'} ${trip.name}`} title={owner ? 'Delete trip' : 'Leave trip'}
            onClick={onRemove}>
            {owner ? <TrashIcon /> : <LeaveIcon />}
          </button>
        </div>
      </div>
    </article>
  )
}

/** Owners delete a trip for everyone; other members leave it. Either way, ask first and say what happens. */
function RemoveTripDialog({ trip, onClose }: { trip: TripSummary; onClose: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const owner = trip.role === 'OWNER'
  const remove = useMutation({
    mutationFn: () => api(owner ? `/api/trips/${trip.id}` : `/api/trips/${trip.id}/members/${user!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] })
      onClose()
    },
  })
  const others = trip.memberCount - 1
  return (
    <Modal title={owner ? 'Delete this trip?' : 'Leave this trip?'} onClose={onClose}>
      <p style={{ margin: 0, lineHeight: 1.55 }}>
        {owner
          ? <>“{trip.name}” and everything in it will be deleted{others > 0 ? `, for you and the ${others} other ${others === 1 ? 'member' : 'members'}` : ''}. This can't be undone.</>
          : <>You'll lose access to “{trip.name}”. A member can invite you back with a new link.</>}
      </p>
      {remove.error && <div role="alert" className="error">{remove.error.message}</div>}
      <div className="spread">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>{owner ? 'Delete trip' : 'Leave trip'}</button>
      </div>
    </Modal>
  )
}

/** A friendly hello that fits the hour. */
function greeting(name: string | undefined, now: Date) {
  const h = now.getHours()
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return `${part}${name ? `, ${name}` : ''}`
}

function upcomingLine(trips: TripSummary[] | undefined, today: Date) {
  if (!trips) return 'Loading your trips…'
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const ahead = trips.filter((t) => t.endDate >= todayIso).length
  if (trips.length === 0) return 'No trips yet. Every good one starts with a single city.'
  if (ahead === 0) return 'All caught up. Where to next?'
  return `${ahead} ${ahead === 1 ? 'trip' : 'trips'} coming up. Where to next?`
}

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // A city picked on the landing page arrives as ?to=City (through sign-up): open Create Trip with it filled in.
  const [params] = useSearchParams()
  const [destination] = useState(() => params.get('to')?.trim().slice(0, 120) ?? '')
  const [creating, setCreating] = useState(params.has('to'))
  const [removing, setRemoving] = useState<TripSummary | null>(null)
  useEffect(() => {
    if (params.has('to')) navigate('/trips', { replace: true })
  }, [params, navigate])
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api<TripSummary[]>('/api/trips') })
  const [today] = useState(() => new Date())

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="spread" style={{ alignItems: 'flex-end', gap: 20 }}>
          <div>
            <p className="muted" style={{ margin: 0, fontWeight: 700 }}>{greeting(user?.displayName, today)} 👋</p>
            <h1 style={{ fontSize: 40, fontWeight: 800, marginTop: 6 }}>My Trips</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>{upcomingLine(trips.data, today)}</p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Link className="btn" style={{ minHeight: 48, borderRadius: 14 }} to="/import">Import itinerary</Link>
            <button className="btn btn-primary" style={{ minHeight: 48, borderRadius: 14 }} onClick={() => setCreating(true)}>
              <PlusIcon /> Create Trip
            </button>
          </div>
        </div>
        {trips.error && <div role="alert" className="error" style={{ marginTop: 24 }}>{trips.error.message}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24, marginTop: 36 }}>
          {trips.data?.map((t) => <TripCard key={t.id} trip={t} today={today} onRemove={() => setRemoving(t)} />)}
          <button className="new-trip" onClick={() => setCreating(true)}>
            <span className="plane" aria-hidden="true" style={{ width: 60, height: 60, borderRadius: '50%', background: '#fff', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}>
              <PlusIcon size={24} color="#0E7C74" />
            </span>
            Start a new trip
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>A name, one destination and dates. That's it.</span>
          </button>
        </div>
      </main>
      {creating && <CreateTripDialog destination={destination} onClose={() => setCreating(false)} />}
      {removing && <RemoveTripDialog trip={removing} onClose={() => setRemoving(null)} />}
    </>
  )
}
