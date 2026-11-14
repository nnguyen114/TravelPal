import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../api'
import { formatRange } from '../trip'
import type { InvitePreview } from '../types'
import { TopBar } from './Dashboard'

export function JoinPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const preview = useQuery({ queryKey: ['invite', token], queryFn: () => api<InvitePreview>(`/api/invites/${token}`) })
  const join = useMutation({
    mutationFn: () => api<{ tripId: string }>(`/api/invites/${token}/join`, { method: 'POST' }),
    onSuccess: (r) => navigate(`/trips/${r.tripId}`),
  })
  const p = preview.data

  return (
    <>
      <TopBar />
      <main className="page" style={{ maxWidth: 520 }}>
        {preview.error && (
          <div className="card" style={{ padding: 24 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>This invite doesn’t work</h1>
            <p className="muted">{preview.error.message}. Ask a trip member for a new link.</p>
            <Link to="/">Go to My Trips</Link>
          </div>
        )}
        {p && (
          <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="muted" style={{ margin: 0, fontWeight: 600 }}>You’re invited to plan</p>
            <h1 style={{ fontSize: 32, fontWeight: 800 }}>{p.name}</h1>
            <div style={{ color: 'var(--ink-2)' }}>{p.cities.join(' · ')}</div>
            <div className="muted row" style={{ fontSize: 14, fontWeight: 600 }}>
              <span>{formatRange(p.startDate, p.endDate)}</span>
              <span>{p.memberCount} {p.memberCount === 1 ? 'member' : 'members'}</span>
            </div>
            {join.error && <div role="alert" className="error">{join.error.message}</div>}
            {p.member
              ? <Link className="btn btn-primary" to={`/trips/${p.tripId}`}>You’re already in. Open Trip</Link>
              : <button className="btn btn-primary" disabled={join.isPending} onClick={() => join.mutate()}>Join Trip</button>}
          </div>
        )}
      </main>
    </>
  )
}
