import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, readEvents } from './api'
import { CloseIcon, SparkleIcon } from './icons'
import { useOptimize } from './optimize'
import { canEdit } from './trip'
import type { Mode, Place, Trip } from './types'

type Proposal =
  | { type: 'places'; places: { name: string; day_number: number }[] }
  | { type: 'optimize'; mode: Mode; day_number: number; instructions: string }
  | { type: 'discover'; query: string; day_number: number }
type Msg = { role: 'user' | 'assistant'; content: string; proposals: Proposal[] }

const SUGGESTED = ['How full is Day 1?', 'Here are some places: …', 'Make Day 2 lighter']

function PlacesProposal({ trip, p }: { trip: Trip; p: Extract<Proposal, { type: 'places' }> }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const bias = trip.cities.find((c) => c.lat != null)

  // ponytail: takes the top search match per name; add a pick-the-right-one step if matches go wrong often.
  async function add() {
    setBusy(true)
    let unlocated = 0
    let failed = 0
    for (const place of p.places) {
      const q = new URLSearchParams({ q: place.name })
      if (bias) {
        q.set('lat', String(bias.lat))
        q.set('lng', String(bias.lng))
      }
      const match = (await api<Place[]>(`/api/places/search?${q}`).catch(() => []))[0]
      if (!match) unlocated++
      await api(`/api/trips/${trip.id}/destinations`, {
        method: 'POST',
        body: {
          name: match?.name ?? place.name, address: match?.address ?? null, lat: match?.lat ?? null, lng: match?.lng ?? null,
          providerId: match?.providerId ?? null, notes: null, durationMin: 60, startTime: null, locked: false, flexibility: 'FLEXIBLE',
          dayIndex: place.day_number > 0 && place.day_number <= trip.dayCount ? place.day_number - 1 : null,
        },
      }).catch(() => failed++)
    }
    qc.invalidateQueries({ queryKey: ['destinations', trip.id] })
    setBusy(false)
    setDone([
      `Added ${p.places.length - failed} of ${p.places.length}.`,
      unlocated ? `${unlocated} without a map location yet.` : '',
      failed ? `${failed} already in the trip or couldn't be added.` : '',
    ].filter(Boolean).join(' '))
  }

  return (
    <div className="card" style={{ padding: 12, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
        {p.places.map((x, i) => <li key={i}>{x.name}{x.day_number > 0 ? ` · Day ${x.day_number}` : ' · idea'}</li>)}
      </ul>
      {done
        ? <span role="status" style={{ fontSize: 13, fontWeight: 600 }}>{done}</span>
        : <button className="btn btn-primary" disabled={!canEdit(trip) || busy} onClick={add}>
            {canEdit(trip) ? `Add ${p.places.length} ${p.places.length === 1 ? 'place' : 'places'}` : 'Only editors can add'}
          </button>}
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

/** On-demand trip copilot. Anything that would change the trip comes back as a button the traveler presses. */
export function AssistantDrawer({ trip, onClose, onDiscover }: {
  trip: Trip; onClose: () => void; onDiscover: (query: string, dayIndex: number | null) => void
}) {
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
        if (name === 'error') setError(JSON.parse(data).message)
      }, ctrl.current.signal, { messages: history.map(({ role, content }) => ({ role, content: content || '…' })) })
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
    <aside aria-label="AI assistant" className="assistant">
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
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Paste a list of places, ask whether something fits, or ask for a lighter day. I suggest; you decide.</p>
            <div className="row" style={{ gap: 8 }}>
              {SUGGESTED.map((s) => <button key={s} className="btn btn-soft" style={{ borderRadius: 999 }} onClick={() => send(s)}>{s}</button>)}
            </div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: m.role === 'user' ? 'flex-end' : 'stretch' }}>
            {(m.content || (busy && i === msgs.length - 1)) && (
              <div className={m.role === 'user' ? 'bubble-user' : 'bubble-ai'}>{m.content || 'Thinking…'}</div>
            )}
            {m.proposals.map((p, j) => p.type === 'places'
              ? <PlacesProposal key={j} trip={trip} p={p} />
              : p.type === 'optimize'
                ? <OptimizeProposal key={j} trip={trip} p={p} />
                : (
                  <button key={j} className="btn btn-primary"
                    onClick={() => onDiscover(p.query, p.day_number > 0 && p.day_number <= trip.dayCount ? p.day_number - 1 : null)}>
                    Show suggestions: {p.query}
                  </button>
                ))}
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
