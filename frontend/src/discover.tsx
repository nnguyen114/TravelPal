import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api } from './api'
import { Modal } from './dialogs'
import { canEdit } from './trip'
import type { DiscoverResult, Proposal, Suggestion, Trip } from './types'

export type DiscoverAsk = { dayIndex: number | null; query?: string; like?: { id: string; name: string }; context: string }

const TINTS = [['#E2F3F0', '#0E7C74'], ['#FDEBE4', '#C2532F'], ['#ECEAFD', '#5B4FD0']]

/** Find More Places: only runs when asked, and nothing joins the trip unless the traveler picks it. */
export function DiscoverSheet({ trip, ask, onClose }: { trip: Trip; ask: DiscoverAsk; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [query, setQuery] = useState(ask.query ?? '')
  const [done, setDone] = useState<Record<string, string>>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const search = useMutation({
    mutationFn: (body: object) => api<DiscoverResult>(`/api/trips/${trip.id}/discover`, { method: 'POST', body }),
  })
  const run = (q: string) => search.mutate({ query: q || null, dayIndex: ask.dayIndex, likeDestinationId: ask.like?.id ?? null })
  // A request that arrives with a query (from chat) or a place to match runs straight away.
  useEffect(() => {
    if (ask.query || ask.like) run(ask.query ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function act(s: Suggestion, how: 'add' | 'save' | 'propose' | 'skip') {
    const place = { name: s.name, address: s.address, lat: s.lat, lng: s.lng, providerId: s.providerId }
    try {
      if (how === 'skip') {
        await api(`/api/trips/${trip.id}/discover/not-interested`, { method: 'POST', body: { providerId: s.providerId, name: s.name } })
        setHidden(new Set(hidden).add(s.providerId))
        return
      }
      if (how === 'propose') {
        const p = await api<Proposal>(`/api/trips/${trip.id}/proposals`, {
          method: 'POST', body: { title: `Add ${s.name}`, description: s.why, changes: [{ kind: 'ADD', ...place, dayIndex: ask.dayIndex }] },
        })
        qc.invalidateQueries({ queryKey: ['proposals', trip.id] })
        setDone({ ...done, [s.providerId]: 'Proposed to the group' })
        return void p
      }
      await api(`/api/trips/${trip.id}/destinations`, {
        method: 'POST',
        body: { ...place, notes: null, durationMin: 60, startTime: null, locked: false, flexibility: 'FLEXIBLE',
          dayIndex: how === 'add' ? ask.dayIndex : null },
      })
      qc.invalidateQueries({ queryKey: ['destinations', trip.id] })
      setDone({ ...done, [s.providerId]: how === 'add' ? (ask.dayIndex === null ? 'Added as an idea' : `Added to Day ${ask.dayIndex + 1}`) : 'Saved as an idea' })
    } catch (e) {
      setDone({ ...done, [s.providerId]: (e as Error).message })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (query.trim()) run(query)
  }

  const results = search.data?.suggestions.filter((s) => !hidden.has(s.providerId)) ?? []
  const editor = canEdit(trip)
  return (
    <Modal title="Find More Places" onClose={onClose}>
      <p className="muted" style={{ margin: '-8px 0 0', fontSize: 13 }}>{ask.context}</p>
      <form onSubmit={submit} className="row" style={{ flexWrap: 'nowrap' }}>
        <label htmlFor="discover-q" className="sr-only">What are you looking for?</label>
        <input id="discover-q" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500}
          placeholder={ask.like ? `More like ${ask.like.name}, optionally…` : 'Chic independent cafes like the ones I saved'}
          style={{ flex: 1, minHeight: 44, border: '1.5px solid var(--line-2)', borderRadius: 12, padding: '0 12px' }} />
        <button className="btn btn-primary" disabled={search.isPending || (!query.trim() && !ask.like)}>Search</button>
      </form>
      {search.data?.vibe && (
        <div style={{ background: 'var(--accent-soft)', borderRadius: 14, padding: '10px 12px', fontSize: 13, color: '#1F4E4A' }}>
          You asked for: {search.data.vibe}
        </div>
      )}
      {search.isPending && <p role="status" className="muted" style={{ margin: 0 }}>Looking nearby…</p>}
      {search.error && <div role="alert" className="error">{search.error.message}</div>}
      {search.isSuccess && results.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing matched nearby. Try different words.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '50vh', overflowY: 'auto' }}>
        {results.map((s, i) => (
          <article key={s.providerId} aria-label={s.name} style={{ border: '1px solid var(--line)', borderRadius: 18, padding: 14 }}>
            <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ width: 48, height: 48, flex: 'none', borderRadius: 14, background: TINTS[i % 3][0], color: TINTS[i % 3][1],
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{s.name.slice(0, 1)}</span>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 15, fontWeight: 800 }}>{s.name}</h3>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{[s.category, s.address, `${s.distanceKm} km`].filter(Boolean).join(' · ')}</div>
                <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.45 }}><strong>Why this?</strong> {s.why}</div>
              </div>
            </div>
            {done[s.providerId]
              ? <p role="status" style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 700 }}>{done[s.providerId]}</p>
              : (
                <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'nowrap' }}>
                  {editor && <button className="btn btn-primary" style={{ flex: 1, minHeight: 40 }} onClick={() => act(s, 'add')}>Add</button>}
                  <button className="btn" style={{ flex: 1, minHeight: 40 }} onClick={() => act(s, 'propose')}>Propose</button>
                  {editor && <button className="btn" style={{ flex: 1, minHeight: 40 }} onClick={() => act(s, 'save')}>Save</button>}
                  <button className="btn" aria-label={`Not interested in ${s.name}`} style={{ width: 40, minHeight: 40, padding: 0 }} onClick={() => act(s, 'skip')}>✕</button>
                </div>
              )}
          </article>
        ))}
      </div>
      {results.length > 0 && (
        <>
          <button className="btn btn-ghost" disabled={search.isPending}
            onClick={() => run(`${query || ask.like?.name || ''}, more like ${results.slice(0, 3).map((s) => s.name).join(', ')}`)}>
            More like these
          </button>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>{search.data?.note}</p>
        </>
      )}
      {Object.values(done).some((d) => d.startsWith('Proposed')) && (
        <button className="btn btn-ghost" onClick={() => navigate(`/trips/${trip.id}/suggestions`)}>See proposals</button>
      )}
    </Modal>
  )
}
