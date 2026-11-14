import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { canEdit } from '../trip'
import type { HistoryEntry, Role, Trip } from '../types'

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' }

export function MembersTab({ trip }: { trip: Trip }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isOwner = trip.role === 'OWNER'
  const refresh = () => qc.invalidateQueries({ queryKey: ['trip', trip.id] })
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api(`/api/trips/${trip.id}/members/${id}`, { method: 'PUT', body: { role } }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/trips/${trip.id}/members/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => (id === user?.id ? navigate('/') : refresh()),
  })
  const error = setRole.error ?? remove.error

  return (
    <main className="page" style={{ maxWidth: 760, paddingTop: 24 }}>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Anyone with an invite link can join as an editor. Owners can change roles; viewers can look but not edit.
      </p>
      {error && <div role="alert" className="error">{error.message}</div>}
      <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {trip.members.map((m) => {
          const me = m.userId === user?.id
          return (
            <li key={m.userId} className="card spread" style={{ padding: '12px 16px', borderRadius: 16 }}>
              <div className="row">
                <span className="avatar">{m.displayName.slice(0, 1).toUpperCase()}</span>
                <strong>{m.displayName}{me && ' (you)'}</strong>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {isOwner && !me ? (
                  <select aria-label={`Role for ${m.displayName}`} value={m.role}
                    style={{ minHeight: 40, borderRadius: 10, border: '1.5px solid var(--line-2)', padding: '0 8px' }}
                    onChange={(e) => setRole.mutate({ id: m.userId, role: e.target.value as Role })}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : <span className="pill">{ROLE_LABEL[m.role]}</span>}
                {(me || isOwner) && (
                  <button className="btn btn-soft" onClick={() => remove.mutate(m.userId)}>{me ? 'Leave trip' : 'Remove'}</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000)
  if (s > -60) return 'just now'
  if (s > -3600) return ago.format(Math.round(s / 60), 'minute')
  if (s > -86400) return ago.format(Math.round(s / 3600), 'hour')
  return ago.format(Math.round(s / 86400), 'day')
}

export function ActivityTab({ trip }: { trip: Trip }) {
  const qc = useQueryClient()
  // ponytail: newest 100 only; the API pages with ?before= when older history is needed in the UI.
  const events = useQuery({ queryKey: ['events', trip.id], queryFn: () => api<HistoryEntry[]>(`/api/trips/${trip.id}/events?limit=100`) })
  const undo = useMutation({
    mutationFn: (id: number) => api(`/api/trips/${trip.id}/events/${id}/undo`, { method: 'POST' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['events', trip.id] })
      qc.invalidateQueries({ queryKey: ['destinations', trip.id] })
    },
  })

  return (
    <main className="page" style={{ maxWidth: 760, paddingTop: 24 }}>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Every change to the shared trip. Undo only works while nobody has changed that place since.
      </p>
      {(events.error ?? undo.error) && <div role="alert" className="error">{(events.error ?? undo.error)!.message}</div>}
      <ol style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.data?.map((e) => (
          <li key={e.id} className="spread" style={{ padding: '10px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <span style={{ fontSize: 14, textDecoration: e.undone ? 'line-through' : undefined, color: e.undone ? 'var(--muted)' : undefined }}>
              <strong>{e.actorName ?? 'Someone'}</strong> {e.summary}
              <span className="muted"> · {timeAgo(e.createdAt)}</span>
            </span>
            {e.undoable && canEdit(trip) && (
              <button className="btn btn-soft" disabled={undo.isPending} onClick={() => undo.mutate(e.id)}>Undo</button>
            )}
          </li>
        ))}
      </ol>
    </main>
  )
}
