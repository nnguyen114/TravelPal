import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api } from '../api'
import { Empty } from '../art'
import { useAuth } from '../auth'
import { Modal, PlaceSearch } from '../dialogs'
import { PlusIcon } from '../icons'
import { canEdit, dayDate, formatDay } from '../trip'
import type { Destination, Place, Proposal, ProposalChange, Trip } from '../types'
import { timeAgo } from './CollabTabs'

type Status = Proposal['status']
const STATUS: [Status, string][] = [['OPEN', 'Open'], ['MERGED', 'Merged'], ['CLOSED', 'Closed']]
const PILL: Record<Status, { bg: string; ink: string }> = {
  OPEN: { bg: 'var(--accent-tint)', ink: 'var(--accent-ink)' },
  MERGED: { bg: '#ECEAFD', ink: '#4B3FB8' },
  CLOSED: { bg: 'var(--soft)', ink: 'var(--muted)' },
}

const days = (p: Proposal) => (p.affectedDays.length ? `Day${p.affectedDays.length > 1 ? 's' : ''} ${p.affectedDays.map((d) => d + 1).join(', ')}` : 'No day')

export function describe(c: ProposalChange): string {
  const at = c.startTime ? ` at ${c.startTime.slice(0, 5)}` : ''
  if (c.kind === 'ADD') return `Add ${c.name}${c.dayIndex === null ? ' as an idea' : ` to Day ${c.dayIndex + 1}${at}`}`
  if (c.kind === 'REMOVE') return `Remove ${c.name}`
  const from = c.fromDay === null ? 'Unscheduled' : `Day ${c.fromDay + 1}`
  return `Move ${c.name} from ${from} to ${c.dayIndex === null ? 'Unscheduled' : `Day ${c.dayIndex + 1}${at}`}`
}

function Detail({ trip, p, onStatus }: { trip: Trip; p: Proposal; onStatus: (s: Status) => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [comment, setComment] = useState('')
  const act = useMutation({
    mutationFn: (path: string) => api<Proposal>(`/api/trips/${trip.id}/proposals/${p.id}/${path}`, { method: 'POST' }),
    onSuccess: (fresh) => {
      qc.setQueryData(['proposal', p.id], fresh)
      qc.invalidateQueries({ queryKey: ['proposals', trip.id] })
      qc.invalidateQueries({ queryKey: ['destinations', trip.id] })
      onStatus(fresh.status)
    },
  })
  const post = useMutation({
    mutationFn: (body: string) => api<Proposal>(`/api/trips/${trip.id}/proposals/${p.id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: (fresh) => {
      qc.setQueryData(['proposal', p.id], fresh)
      setComment('')
    },
  })
  const open = p.status === 'OPEN'
  const mayClose = open && (canEdit(trip) || p.authorId === user?.id)

  return (
    <article className="card" style={{ padding: 24, flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }} aria-label={p.title}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="pill" style={{ background: PILL[p.status].bg, color: PILL[p.status].ink, fontSize: 11, fontWeight: 800, letterSpacing: '.04em' }}>{p.status}</span>
          <h2 style={{ fontSize: 24, fontWeight: 800, marginTop: 10 }}>{p.title}</h2>
          <div className="row muted" style={{ fontSize: 14, marginTop: 6, gap: 8 }}>
            <span className="avatar" aria-hidden="true">{p.authorName.slice(0, 1)}</span>
            Proposed by {p.authorName} · affects {days(p)}
          </div>
        </div>
        {open && (
          <div className="row" style={{ gap: 8 }}>
            {mayClose && <button className="btn" disabled={act.isPending} onClick={() => act.mutate('close')}>Close</button>}
            {canEdit(trip) && (
              <button className="btn btn-primary" disabled={act.isPending || p.stale} onClick={() => act.mutate('merge')}>Accept and Merge</button>
            )}
          </div>
        )}
      </div>
      {act.error && <div role="alert" className="error">{act.error.message}</div>}
      {p.stale && open && (
        <div role="status" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)', borderRadius: 12, padding: '10px 14px', fontWeight: 600, fontSize: 14 }}>
          A place in this proposal changed since it was made, so it can't be merged as is. Close it and propose again.
        </div>
      )}
      {p.description && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{p.description}</p>}
      <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15 }} aria-label="Changes">
        {p.changes.map((c, i) => <li key={i}>{describe(c)}</li>)}
      </ul>

      <section style={{ background: 'var(--bg)', borderRadius: 16, padding: '16px 18px' }} aria-label="Impact check">
        <div className="spread">
          <h3 style={{ fontSize: 15, fontWeight: 800 }}>Impact check</h3>
          {p.impactByName && <span className="muted" style={{ fontSize: 12 }}>requested by {p.impactByName}</span>}
        </div>
        {p.impact ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
            {([['Does it fit?', p.impact.fits], ['Conflicts', p.impact.conflicts], ['Day effect', p.impact.dayEffect]] as const).map(([k, v]) => (
              <div key={k} style={{ background: 'var(--surface)', borderRadius: 12, padding: '10px 12px' }}>
                <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{k}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : <p className="muted" style={{ margin: '8px 0 0', fontSize: 14 }}>Ask the AI whether this fits, clashes with locked plans, and what else would shift.</p>}
        {p.impact?.basis && <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>{p.impact.basis}</p>}
        {open && (
          <button className="btn btn-soft" style={{ marginTop: 12 }} disabled={act.isPending} onClick={() => act.mutate('impact')}>
            {act.isPending && act.variables === 'impact' ? 'Checking…' : p.impact ? 'Check again' : 'Check impact'}
          </button>
        )}
      </section>

      <section aria-label="Discussion">
        <h3 style={{ fontSize: 15, fontWeight: 800 }}>Discussion</h3>
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {p.comments?.length === 0 && <li className="muted" style={{ fontSize: 14 }}>No comments yet.</li>}
          {p.comments?.map((c) => (
            <li key={c.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <span className="avatar" aria-hidden="true">{c.authorName.slice(0, 1)}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{c.authorName} <span className="muted" style={{ fontWeight: 500 }}>· {timeAgo(c.createdAt)}</span></div>
                <div style={{ fontSize: 14, marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            </li>
          ))}
        </ul>
        <form style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(e) => { e.preventDefault(); if (comment.trim()) post.mutate(comment) }}>
          <label className="field">Add a comment
            <textarea rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {post.error && <div role="alert" className="error">{post.error.message}</div>}
          <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={post.isPending || !comment.trim()}>Post</button>
        </form>
      </section>
    </article>
  )
}

type Draft = { kind: 'ADD' | 'MOVE' | 'REMOVE'; place?: Place | null; name?: string; destinationId?: string; day: string }

function NewProposalDialog({ trip, destinations, onClose }: { trip: Trip; destinations: Destination[]; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Draft[]>([{ kind: 'ADD', day: '' }])
  const set = (i: number, patch: Partial<Draft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const create = useMutation({
    mutationFn: (body: unknown) => api<Proposal>(`/api/trips/${trip.id}/proposals`, { method: 'POST', body }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['proposals', trip.id] })
      navigate(`/trips/${trip.id}/suggestions/${p.id}`)
    },
  })
  const bias = trip.cities.find((c) => c.lat != null)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const changes = drafts.map((d) => {
      const dayIndex = d.day === '' ? null : Number(d.day)
      if (d.kind === 'ADD') {
        return { kind: 'ADD', name: d.place?.name ?? d.name, address: d.place?.address, lat: d.place?.lat, lng: d.place?.lng,
          providerId: d.place?.providerId, dayIndex }
      }
      return { kind: d.kind, destinationId: d.destinationId, dayIndex }
    })
    create.mutate({ title: f.get('title'), description: (f.get('description') as string) || null, changes })
  }

  const dayOptions = (
    <>
      <option value="">Unscheduled (idea)</option>
      {Array.from({ length: trip.dayCount }, (_, i) => <option key={i} value={i}>Day {i + 1} · {formatDay(dayDate(trip, i))}</option>)}
    </>
  )
  return (
    <Modal title="New proposal" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">Title<input name="title" required maxLength={140} placeholder="Add Tsukiji Outer Market" /></label>
        <label className="field">Why? (optional)<textarea name="description" rows={2} maxLength={4000} /></label>
        {drafts.map((d, i) => (
          <fieldset key={i} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 12, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <legend className="muted" style={{ fontSize: 12, fontWeight: 700, padding: '0 4px' }}>Change {i + 1}</legend>
            <label className="field">What
              <select value={d.kind} onChange={(e) => set(i, { kind: e.target.value as Draft['kind'] })}>
                <option value="ADD">Add a place</option>
                <option value="MOVE">Move a place</option>
                <option value="REMOVE">Remove a place</option>
              </select>
            </label>
            {d.kind === 'ADD'
              ? <PlaceSearch label="Place" bias={bias} onPick={(p, text) => set(i, { place: p, name: text })} />
              : (
                <label className="field">Place
                  <select required value={d.destinationId ?? ''} onChange={(e) => set(i, { destinationId: e.target.value })}>
                    <option value="" disabled>Choose…</option>
                    {destinations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              )}
            {d.kind !== 'REMOVE' && (
              <label className="field">{d.kind === 'MOVE' ? 'Move to' : 'Day'}
                <select value={d.day} onChange={(e) => set(i, { day: e.target.value })}>{dayOptions}</select>
              </label>
            )}
          </fieldset>
        ))}
        <button type="button" className="btn btn-soft" style={{ alignSelf: 'flex-start' }} disabled={drafts.length >= 20}
          onClick={() => setDrafts([...drafts, { kind: 'ADD', day: '' }])}>+ Add another change</button>
        {create.error && <div role="alert" className="error">{create.error.message}</div>}
        <button className="btn btn-primary" disabled={create.isPending}>Propose to Group</button>
      </form>
    </Modal>
  )
}

export function SuggestionsTab({ trip, destinations, proposals }: { trip: Trip; destinations: Destination[]; proposals: Proposal[] }) {
  const { proposalId } = useParams()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Status>('OPEN')
  const [creating, setCreating] = useState(false)
  const shown = proposals.filter((p) => p.status === filter)
  const selectedId = proposalId ?? shown[0]?.id
  const detail = useQuery({
    queryKey: ['proposal', selectedId],
    queryFn: () => api<Proposal>(`/api/trips/${trip.id}/proposals/${selectedId}`),
    enabled: !!selectedId,
  })

  return (
    <main className="workspace">
      <section aria-label="Proposal list" style={{ flex: '1 1 320px', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="segmented" role="group" aria-label="Filter proposals">
          {STATUS.map(([s, label]) => (
            <button key={s} aria-pressed={filter === s} onClick={() => { setFilter(s); navigate(`/trips/${trip.id}/suggestions`) }}>
              {label} · {proposals.filter((p) => p.status === s).length}
            </button>
          ))}
        </div>
        {shown.length === 0 && (
          <Empty title={`No ${filter.toLowerCase()} proposals.`}>
            {filter === 'OPEN' ? 'When someone suggests a change to the plan, it shows up here for everyone to weigh in.' : 'Nothing here yet.'}
          </Empty>
        )}
        {shown.map((p) => (
          <button key={p.id} className="card" aria-current={p.id === selectedId ? 'true' : undefined}
            onClick={() => navigate(`/trips/${trip.id}/suggestions/${p.id}`)}
            style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 16, border: p.id === selectedId ? '2px solid var(--accent)' : undefined }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 800 }}>{p.title}</span>
            <span className="muted" style={{ display: 'block', fontSize: 13, marginTop: 4 }}>
              {p.authorName} · {days(p)} · {p.commentCount} {p.commentCount === 1 ? 'comment' : 'comments'}
            </span>
          </button>
        ))}
        <button className="btn" onClick={() => setCreating(true)}><PlusIcon /> New proposal</button>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Proposals are optional. Anyone can still add directly or save an idea.</p>
      </section>
      {detail.data && (
        <Detail trip={trip} p={detail.data} onStatus={(s) => { setFilter(s); navigate(`/trips/${trip.id}/suggestions/${detail.data!.id}`) }} />
      )}
      {detail.error && <div role="alert" className="error">{detail.error.message}</div>}
      {creating && <NewProposalDialog trip={trip} destinations={destinations} onClose={() => setCreating(false)} />}
    </main>
  )
}
