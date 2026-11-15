import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../api'
import { PaceSwitch, useOptimize } from '../optimize'
import { canEdit, cityForDay, dayColor, dayDate, formatDay } from '../trip'
import type { Destination, PlanResult, Preview, Trip } from '../types'

const TAG = {
  moved: { label: 'Moved', bg: '#EEF8F6', ink: '#0A5F59' },
  added: { label: 'Added', bg: '#F4F2FE', ink: '#4B3FB8' },
  locked: { label: 'Locked', bg: '#FFF8E6', ink: '#7A4F00' },
  none: { label: '', bg: '#FAF9F6', ink: '#5B6472' },
}
const NOTE = {
  suggestion: { label: 'SUGGESTION', bg: '#E2F3F0', ink: '#0A5F59' },
  verified: { label: 'VERIFIED', bg: '#ECEAFD', ink: '#4B3FB8' },
  unsure: { label: 'UNSURE', bg: '#FFF1CC', ink: '#7A4F00' },
}

function Ring({ done, total }: { done: number; total: number }) {
  const c = 2 * Math.PI * 26
  const filled = total ? (done / total) * c : 0
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${Math.round(total ? (done / total) * 100 : 0)} percent scheduled`}>
      <circle cx="32" cy="32" r="26" fill="none" stroke="#EDEBE4" strokeWidth="8" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="#14A098" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`} transform="rotate(-90 32 32)" />
    </svg>
  )
}

function Plan({ trip, preview, result, destinations }: { trip: Trip; preview: Preview; result: PlanResult; destinations: Destination[] }) {
  const byId = new Map(destinations.map((d) => [d.id, d]))
  const tag = (id: string) =>
    result.keptLocked.includes(id) ? TAG.locked : result.added.includes(id) ? TAG.added : result.moved.includes(id) ? TAG.moved : TAG.none
  const days = Array.from({ length: trip.dayCount }, (_, i) =>
    result.items.filter((it) => it.dayIndex === i).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))
  const scope = preview.request.scope === 'DAY' ? [preview.request.dayIndex!] : days.map((_, i) => i)
  const review = new Map(result.needsReview.map((n) => [n.id, n.reason]))
  const leftOut = [...result.unscheduled, ...result.needsReview.map((n) => n.id).filter((id) => !result.unscheduled.includes(id))]

  return (
    <>
      <div className="card" style={{ marginTop: 22, padding: '20px 22px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24 }}>
        <Ring done={result.scheduled} total={result.total} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{result.scheduled} of {result.total} destinations scheduled</div>
          <div style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 4 }}>
            {result.unscheduled.length
              ? `${result.unscheduled.length} could not fit. They stay in Unscheduled.`
              : 'Everything fits.'}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="pill" style={{ background: '#E2F3F0', color: '#0A5F59', fontWeight: 700 }}>{result.moved.length} moved</span>
          <span className="pill" style={{ background: '#ECEAFD', color: '#4B3FB8', fontWeight: 700 }}>{result.added.length} added</span>
          <span className="pill" style={{ background: '#FFF1CC', color: '#7A4F00', fontWeight: 700 }}>{result.keptLocked.length} locked, kept</span>
        </div>
      </div>

      <section aria-label="Why this plan" className="card" style={{ marginTop: 16, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 15 }}>{result.explanation}</p>
        {result.notes.map((n, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap', fontSize: 14 }}>
            <span style={{ flex: 'none', background: NOTE[n.kind].bg, color: NOTE[n.kind].ink, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 800, letterSpacing: '.04em' }}>
              {NOTE[n.kind].label}
            </span>
            <span>{n.text}</span>
          </div>
        ))}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 16 }}>
        {scope.map((i) => (
          <article key={i} className="card" style={{ padding: 18 }} aria-label={`Day ${i + 1} preview`}>
            <div className="row" style={{ gap: 10 }}>
              <span className="dot" style={{ width: 12, height: 12, background: dayColor(i) }} aria-hidden="true" />
              <h2 style={{ fontSize: 16, fontWeight: 800 }}>Day {i + 1}</h2>
              <span className="muted" style={{ fontSize: 13 }}>{formatDay(dayDate(trip, i))} · {cityForDay(trip.cities, dayDate(trip, i))?.name}</span>
            </div>
            <ol style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {days[i].length === 0 && <li className="muted" style={{ fontSize: 14 }}>Free day</li>}
              {days[i].map((it) => {
                const t = tag(it.id)
                return (
                  <li key={it.id} className="row" style={{ flexWrap: 'nowrap', gap: 10, padding: '8px 10px', borderRadius: 12, background: t.bg }}>
                    <span style={{ width: 44, flex: 'none', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{it.startTime ?? '—'}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{byId.get(it.id)?.name ?? 'Removed place'}</span>
                    {t.label && <span style={{ fontSize: 11, fontWeight: 800, color: t.ink, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t.label}</span>}
                  </li>
                )
              })}
            </ol>
          </article>
        ))}
      </div>

      {leftOut.length > 0 && (
        <section className="card" style={{ marginTop: 16, padding: '18px 22px' }} aria-label="Could not fit">
          <h2 style={{ fontSize: 16, fontWeight: 800 }}>Could not fit ({result.unscheduled.length})</h2>
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {leftOut.map((id) => (
              <li key={id} className="pill" style={review.has(id) ? { background: 'var(--danger-bg)', color: 'var(--danger-ink)', fontWeight: 700 } : undefined}>
                {review.has(id) ? `Needs Review · ${byId.get(id)?.name}: ${review.get(id)}` : byId.get(id)?.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export function OptimizePage() {
  const { tripId, previewId } = useParams() as { tripId: string; previewId: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [modifying, setModifying] = useState(false)
  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => api<Trip>(`/api/trips/${tripId}`) })
  const destinations = useQuery({ queryKey: ['destinations', tripId], queryFn: () => api<Destination[]>(`/api/trips/${tripId}/destinations`) })
  const preview = useQuery({
    queryKey: ['preview', previewId],
    queryFn: () => api<Preview>(`/api/trips/${tripId}/previews/${previewId}`),
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 1500 : false),
  })
  const rerun = useOptimize(tripId, true)
  const back = () => navigate(`/trips/${tripId}`)
  const apply = useMutation({
    mutationFn: () => api(`/api/trips/${tripId}/previews/${previewId}/apply`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['destinations', tripId] })
      back()
    },
  })
  const discard = useMutation({
    mutationFn: () => api(`/api/trips/${tripId}/previews/${previewId}/discard`, { method: 'POST' }),
    onSuccess: back,
  })

  const p = preview.data
  const t = trip.data
  const error = preview.error ?? trip.error ?? apply.error ?? discard.error ?? rerun.error
  const again = (patch: { mode?: Preview['request']['mode']; instructions?: string | null }) =>
    p && rerun.mutate({ mode: p.request.mode, scope: p.request.scope, dayIndex: p.request.dayIndex, destinationIds: p.request.destinationIds,
      instructions: p.request.instructions, ...patch })
  const slow = p?.status === 'PENDING' && Date.now() - new Date(p.createdAt).getTime() > 60_000

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 32px 48px' }} className="optimize-page">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13 }} className="muted">
        <Link to={`/trips/${tripId}`} style={{ textDecoration: 'none' }}>{t?.name ?? 'Trip'}</Link> <span aria-hidden="true">›</span> Optimize
      </nav>
      <div className="spread" style={{ alignItems: 'flex-end', marginTop: 8 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800 }}>Preview changes</h1>
          <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--ink-2)' }}>Nothing changes until you apply. Locked plans stay where they are.</p>
        </div>
        {p && <PaceSwitch value={p.request.mode} disabled={rerun.isPending || p.status === 'PENDING'} onChange={(mode) => again({ mode })} />}
      </div>

      {error && <div role="alert" className="error" style={{ marginTop: 16 }}>{error.message}</div>}
      {p?.stale && p.status === 'READY' && (
        <div role="status" className="spread" style={{ marginTop: 16, background: 'var(--warn-bg)', color: 'var(--warn-ink)', borderRadius: 14, padding: '12px 16px', fontWeight: 600 }}>
          The trip changed after this preview was made. Run it again to include the latest edits.
          <button className="btn" onClick={() => again({})}>Refresh preview</button>
        </div>
      )}
      {p?.status === 'PENDING' && (
        <div className="card" role="status" style={{ marginTop: 22, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Building your plan…</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{slow ? 'This is taking longer than usual. You can leave and come back.' : 'Grouping places by neighborhood and fitting them into days.'}</p>
        </div>
      )}
      {p?.status === 'FAILED' && (
        <div className="card" style={{ marginTop: 22, padding: 22 }}>
          <div role="alert" className="error">{p.error}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => again({})}>Try again</button>
        </div>
      )}
      {p && (p.status === 'APPLIED' || p.status === 'DISCARDED') && (
        <p className="muted" style={{ marginTop: 22 }}>This preview was {p.status.toLowerCase()}. <Link to={`/trips/${tripId}`}>Back to the trip</Link></p>
      )}
      {p?.status === 'READY' && p.result && t && destinations.data && (
        <Plan trip={t} preview={p} result={p.result} destinations={destinations.data} />
      )}

      {modifying && p && (
        <form className="card" style={{ marginTop: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => { e.preventDefault(); again({ instructions: String(new FormData(e.currentTarget).get('instructions')) }); setModifying(false) }}>
          <label className="field">
            What should change?
            <textarea name="instructions" rows={2} maxLength={2000} defaultValue={p.request.instructions ?? ''}
              placeholder="Start at 10:00, keep Day 3 slow, an extra hour at teamLab" />
          </label>
          <button className="btn btn-primary" disabled={rerun.isPending}>Run again</button>
        </form>
      )}

      {p?.status === 'READY' && t && canEdit(t) && (
        <div className="row" style={{ position: 'sticky', bottom: 0, marginTop: 20, justifyContent: 'flex-end', padding: '14px 0', background: 'var(--bg)', gap: 10 }}>
          <button className="btn btn-ghost" disabled={discard.isPending} onClick={() => discard.mutate()}>Discard</button>
          <button className="btn" onClick={() => setModifying(true)}>Modify</button>
          <button className="btn btn-primary" disabled={apply.isPending || p.stale} onClick={() => apply.mutate()}>Apply Changes</button>
        </div>
      )}
    </main>
  )
}
