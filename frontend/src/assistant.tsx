import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, ApiError, readEvents } from './api'
import { CloseIcon, SparkleIcon } from './icons'
import { useOptimize } from './optimize'
import { canEdit, km } from './trip'
import type { Mode, Place, Trip } from './types'

/** A place the assistant chose: from its own map search (with a location) or by name only (looked up here). */
type Pick = { name: string; day_number: number; lat?: number; lng?: number; providerId?: string; address?: string }
type Proposal =
  | { type: 'places'; places: Pick[] }
  | { type: 'optimize'; mode: Mode; day_number: number; instructions: string }
type Msg = { role: 'user' | 'assistant'; content: string; proposals: Proposal[]; status?: string }

/** The API takes the last 40 messages; a long chat sends its most recent ones, starting with something the traveler said. */
const MAX_MESSAGES = 40
/** A search match farther than this from every trip city is a different place with the same name. */
const NEAR_TRIP_KM = 300
/** Names listed in an added-places card; the rest are counted (they're all in Destinations). */
const SHOWN = 6
export function recent(history: Msg[]) {
  let last = history.slice(-MAX_MESSAGES)
  while (last.length && last[0].role !== 'user') last = last.slice(1)
  return last.map(({ role, content }) => ({ role, content: content || '…' }))
}

const SUGGESTED = ['Find food and sights for my trip', 'How full is Day 1?', 'Make Day 2 lighter']

/** Adds the assistant's places as soon as they arrive (editors only); the traveler keeps or undoes them. */
function PlacesProposal({ trip, p }: { trip: Trip; p: Extract<Proposal, { type: 'places' }> }) {
  const qc = useQueryClient()
  const [added, setAdded] = useState<string[] | null>(null)
  const [note, setNote] = useState('')
  const [undoing, setUndoing] = useState(false)
  const started = useRef(false)
  const gone = useRef(false)
  useEffect(() => {
    gone.current = false
    return () => { gone.current = true }
  }, [])
  const cities = trip.cities.filter((c): c is typeof c & { lat: number; lng: number } => c.lat != null && c.lng != null)
  const bias = cities[0]
  const refresh = () => qc.invalidateQueries({ queryKey: ['destinations', trip.id] })

  /** A name-only pick is looked up near the trip; a match far from every trip city is a namesake, so it's skipped. */
  async function locate(name: string): Promise<Place | undefined> {
    const q = new URLSearchParams({ q: name })
    if (bias) {
      q.set('lat', String(bias.lat))
      q.set('lng', String(bias.lng))
    }
    const match = (await api<Place[]>(`/api/places/search?${q}`).catch(() => []))[0]
    return match && (!cities.length || cities.some((c) => km(c, match) <= NEAR_TRIP_KM)) ? match : undefined
  }

  useEffect(() => {
    if (started.current || !canEdit(trip)) return
    started.current = true // once per proposal, even when React mounts it twice in development
    ;(async () => {
      const ids: string[] = []
      let unlocated = 0
      let failed = 0
      for (const x of p.places) {
        if (gone.current) return // left the trip: stop adding; what's already added stays in Destinations
        const at = x.lat != null ? { ...x, lat: x.lat, lng: x.lng! } : await locate(x.name)
        const day = x.day_number > 0 && x.day_number <= trip.dayCount ? x.day_number - 1 : null
        await api<{ id: string }>(`/api/trips/${trip.id}/destinations`, {
          method: 'POST',
          body: {
            name: at?.name ?? x.name, address: at?.address || null, lat: at?.lat ?? null, lng: at?.lng ?? null,
            providerId: at?.providerId ?? null, notes: null, durationMin: 60, startTime: null, locked: false, flexibility: 'FLEXIBLE',
            dayIndex: day,
          },
        }).then((d) => { ids.push(d.id); if (!at) unlocated++ }, () => failed++)
      }
      refresh()
      setAdded(ids)
      setNote([unlocated ? `${unlocated} not on the map yet` : '', failed ? `${failed} already in the trip` : ''].filter(Boolean).join(' · '))
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Only confirmed deletes leave the list (a 404 means it's already gone); the rest stay for another try. */
  async function undo() {
    const ids = added ?? []
    setUndoing(true)
    const removed = await Promise.all(ids.map((id) => api(`/api/trips/${trip.id}/destinations/${id}`, { method: 'DELETE' })
      .then(() => true, (e) => e instanceof ApiError && e.status === 404)))
    const left = ids.filter((_, i) => !removed[i])
    refresh()
    setAdded(left)
    setUndoing(false)
    setNote(left.length ? `Couldn't remove ${left.length}. Try Undo again.` : 'Removed.')
  }

  const onDays = p.places.filter((x) => x.day_number > 0).length
  return (
    <div className="card" style={{ padding: 12, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 14 }}>
        {p.places.slice(0, SHOWN).map((x) => x.name).join(', ')}
        {p.places.length > SHOWN && <span className="muted"> and {p.places.length - SHOWN} more</span>}
      </span>
      {!canEdit(trip)
        ? <span className="muted" style={{ fontSize: 13 }}>Only editors can add places.</span>
        : added === null
          ? <span role="status" className="muted" style={{ fontSize: 13 }}>Adding…</span>
          : (
            <div className="spread" style={{ gap: 8 }}>
              <span role="status" style={{ fontSize: 13, fontWeight: 600 }}>
                {added.length ? `Added ${added.length} to Destinations${onDays ? ` · ${onDays} on days` : ''}` : ''}
                {note && `${added.length ? ' · ' : ''}${note}`}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <Link className="btn btn-soft" to={`/trips/${trip.id}/destinations`}>View</Link>
                {added.length > 0 && <button className="btn btn-soft" disabled={undoing} onClick={undo}>Undo</button>}
              </span>
            </div>
          )}
    </div>
  )
}

function OptimizeProposal({ trip, p }: { trip: Trip; p: Extract<Proposal, { type: 'optimize' }> }) {
  const run = useOptimize(trip.id)
  const day = p.day_number > 0 && p.day_number <= trip.dayCount ? p.day_number - 1 : null
  return (
    <div className="card" style={{ padding: 12, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 14 }}>
        {p.mode[0] + p.mode.slice(1).toLowerCase()} plan for {day === null ? 'the whole trip' : `Day ${day + 1}`}
        {p.instructions && <span className="muted"> · “{p.instructions}”</span>}
      </span>
      <button className="btn btn-primary" disabled={!canEdit(trip) || run.isPending}
        onClick={() => run.mutate({ mode: p.mode, scope: day === null ? 'TRIP' : 'DAY', dayIndex: day, instructions: p.instructions })}>
        {canEdit(trip) ? 'Preview plan' : 'Only editors can optimize'}
      </button>
    </div>
  )
}

/**
 * On-demand trip copilot. Places it picks are added right away (with Undo); day rearrangements stay a preview.
 * Closing only hides it, so a running add, its Undo and the chat are all still there when it reopens.
 */
export function AssistantDrawer({ trip, open, onClose }: { trip: Trip; open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const ctrl = useRef<AbortController | null>(null)
  useEffect(() => () => ctrl.current?.abort(), [])
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [msgs])

  async function send(text: string) {
    if (!text.trim() || busy) return
    const history = [...msgs, { role: 'user' as const, content: text.trim(), proposals: [] }]
    setMsgs([...history, { role: 'assistant', content: '', proposals: [] }])
    setBusy(true)
    setError(null)
    ctrl.current = new AbortController()
    const patch = (f: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), f(all[all.length - 1])])
    try {
      await readEvents(`/api/trips/${trip.id}/assistant`, (name, data) => {
        if (name === 'text') patch((m) => ({ ...m, content: m.content + JSON.parse(data).text }))
        if (name === 'proposal') patch((m) => ({ ...m, proposals: [...m.proposals, JSON.parse(data)] }))
        if (name === 'status') patch((m) => ({ ...m, status: JSON.parse(data).text }))
        if (name === 'error') setError(JSON.parse(data).message)
      }, ctrl.current.signal, { messages: recent(history) })
    } catch (e) {
      if (!ctrl.current.signal.aborted) setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const box = e.currentTarget.elements.namedItem('ask') as HTMLTextAreaElement
    send(box.value)
    box.value = ''
  }

  return (
    <aside aria-label="AI assistant" className="assistant" hidden={!open}>
      <div className="spread" style={{ padding: '16px 18px', borderBottom: '1px solid #EFEDE7', flexWrap: 'nowrap' }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SparkleIcon color="#FFD66B" />
          </span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Trip assistant</div>
            <div className="muted" style={{ fontSize: 12 }}>Knows {trip.name}, its days and locks</div>
          </div>
        </div>
        <button className="icon-btn" aria-label="Close assistant" onClick={onClose}><CloseIcon /></button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {msgs.length === 0 && (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Ask for ideas in a city, paste a list of places, or ask for a lighter day. Places I find go straight into Destinations, and you can undo.</p>
            <div className="row" style={{ gap: 8 }}>
              {SUGGESTED.map((s) => <button key={s} className="btn btn-soft" style={{ borderRadius: 999 }} onClick={() => send(s)}>{s}</button>)}
            </div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: m.role === 'user' ? 'flex-end' : 'stretch' }}>
            {(m.content || (busy && i === msgs.length - 1)) && (
              <div className={m.role === 'user' ? 'bubble-user' : 'bubble-ai'}>{m.content || m.status || 'Thinking…'}</div>
            )}
            {m.proposals.map((p, j) => p.type === 'places'
              ? <PlacesProposal key={j} trip={trip} p={p} />
              : <OptimizeProposal key={j} trip={trip} p={p} />)}
          </div>
        ))}
        {error && <div role="alert" className="error">{error}</div>}
        <div ref={end} />
      </div>

      <form onSubmit={submit} style={{ padding: '14px 18px 18px', borderTop: '1px solid #EFEDE7' }}>
        <label htmlFor="ask" className="muted" style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Message the assistant</label>
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end', border: '1.5px solid var(--line-2)', borderRadius: 16, padding: '8px 8px 8px 14px' }}>
          <textarea id="ask" name="ask" rows={2} maxLength={20000} placeholder="Paste places, or ask “Can this shop fit on Day 3?”"
            style={{ flex: 1, border: 0, outline: 'none', resize: 'none', fontSize: 14, background: 'transparent' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
          <button aria-label="Send" className="btn btn-primary" style={{ width: 44, padding: 0 }} disabled={busy}>→</button>
        </div>
      </form>
    </aside>
  )
}

export function AskAiButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-dark ask-ai" onClick={onClick}>
      <SparkleIcon size={20} color="#FFD66B" /> Ask AI
    </button>
  )
}
