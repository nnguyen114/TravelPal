import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { api } from './api'
import { CloseIcon } from './icons'
import { dayDate, formatDay, toInput } from './trip'
import type { Destination, DestinationInput, Flexibility, LinkResult, Place, Proposal, Trip } from './types'

/** A password field with a Show/Hide button (GOV.UK pattern). It hides again on submit, so the browser never
 * offers to remember it as plain text. The button sits outside the label so the field's name stays "Password". */
export function PasswordInput({ label = 'Password', ...input }: { label?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const form = ref.current?.form
    const hide = () => setShown(false)
    form?.addEventListener('submit', hide)
    return () => form?.removeEventListener('submit', hide)
  }, [])
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-field">
        <input {...input} ref={ref} id={id} type={shown ? 'text' : 'password'} autoCapitalize="none" spellCheck={false} />
        <button type="button" className="pw-toggle" aria-controls={id} aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current!
    if (d.showModal) d.showModal()
    else d.setAttribute('open', '')
  }, [])
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      <div className="dialog-body">
        <div className="spread">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>
        {children}
      </div>
    </dialog>
  )
}

const errorText = (e: unknown) => (e ? <div role="alert" className="error">{(e as Error).message}</div> : null)

/** Searches places through core-api; picking one fills the form, typing alone is a manual entry. */
export function PlaceSearch({ label, bias, onPick, required = true, initial = '' }: {
  label: string; bias?: { lat: number | null; lng: number | null }; onPick: (p: Place | null, text: string) => void; required?: boolean
  initial?: string
}) {
  const [q, setQ] = useState(initial)
  const [results, setResults] = useState<Place[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  // The text whose results are on screen (or on their way); answers for older text are dropped.
  const asked = useRef<string | null>(null)

  async function search(text: string) {
    const t = text.trim()
    if (t.length < 2 || t === asked.current) return
    asked.current = t
    const params = new URLSearchParams({ q: t })
    if (bias?.lat != null && bias?.lng != null) {
      params.set('lat', String(bias.lat))
      params.set('lng', String(bias.lng))
    }
    setError(null)
    setSearching(true)
    try {
      const found = await api<Place[]>(`/api/places/search?${params}`)
      if (asked.current === t) setResults(found)
    } catch (e) {
      if (asked.current !== t) return
      setResults([])
      setError((e as Error).message) // e.g. the provider is down: say so rather than show "no matches"
    } finally {
      if (asked.current === t) setSearching(false)
    }
  }

  // Results as you type, after a short pause (Enter searches straight away). Also covers arriving with text filled in.
  useEffect(() => {
    if (picked) return
    const timer = setTimeout(() => search(q), 400)
    return () => clearTimeout(timer)
  }, [q, picked]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="field">
      <label htmlFor="place-q">{label}</label>
      <input id="place-q" value={q} required={required} maxLength={200} autoComplete="off" placeholder="Start typing a place or city"
        onChange={(e) => { setQ(e.target.value); setPicked(null); onPick(null, e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(q) } }} />
      {results.length > 0 && !picked && (
        <ul aria-label="Search results" style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--line)', borderRadius: 12, maxHeight: 220, overflow: 'auto' }}>
          {results.map((p) => (
            <li key={p.providerId}>
              <button type="button" style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', padding: '10px 12px', minHeight: 44 }}
                onClick={() => { setQ(p.name); setPicked(p.providerId); setResults([]); asked.current = null; onPick(p, p.name) }}>
                <strong style={{ display: 'block', fontSize: 14 }}>{p.name}</strong>
                <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>{p.address}</span>
              </button>
            </li>
          ))}
          <li className="muted" style={{ fontSize: 11, padding: '6px 12px', borderTop: '1px solid var(--line)' }}>
            Search by Geoapify · © OpenStreetMap contributors
          </li>
        </ul>
      )}
      {error && <div role="alert" className="error">{error} You can still add it as typed, without a map location.</div>}
      <span className="muted" style={{ fontWeight: 500 }} aria-live="polite">
        {picked || error || q.trim().length < 2 ? ''
          : searching ? 'Searching…'
          : results.length ? 'Pick one, or keep typing to add it as typed.'
          : asked.current === q.trim() ? 'No matches. It will be added as typed.' : ''}
      </span>
    </div>
  )
}

/** Paste a Maps/TikTok/YouTube/website link; we suggest matching places and the traveler confirms one. */
function LinkImport({ trip, onPick }: { trip: Trip; onPick: (p: Place) => void }) {
  const [url, setUrl] = useState('')
  const lookup = useMutation({
    mutationFn: () => api<LinkResult>(`/api/trips/${trip.id}/places/from-link`, { method: 'POST', body: { url } }),
  })
  const r = lookup.data
  return (
    <div className="field">
      <label htmlFor="link-url">Or paste a link (Google Maps, TikTok video, YouTube video, a website)</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input id="link-url" type="url" style={{ flex: 1 }} value={url} maxLength={2000} placeholder="https://"
          onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className="btn" disabled={!/^https?:\/\/./i.test(url) || lookup.isPending} onClick={() => lookup.mutate()}>
          {lookup.isPending ? 'Reading…' : 'Look up'}
        </button>
      </div>
      {errorText(lookup.error)}
      {r?.message && <span role="status" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{r.message}</span>}
      {r && r.candidates.length > 0 && (
        <ul aria-label="Places from the link" style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--line)', borderRadius: 12 }}>
          {r.candidates.map((p, i) => (
            <li key={`${p.providerId}-${i}`}>
              <button type="button" style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', padding: '10px 12px', minHeight: 44 }}
                onClick={() => { onPick(p); lookup.reset(); setUrl('') }}>
                <strong style={{ display: 'block', fontSize: 14 }}>{p.name}</strong>
                <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>{p.address || 'From the link'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CreateTripDialog({ onClose, destination = '' }: { onClose: () => void; destination?: string }) {
  const navigate = useNavigate()
  const [place, setPlace] = useState<{ p: Place | null; text: string }>({ p: null, text: destination })
  const create = useMutation({
    mutationFn: (body: unknown) => api<Trip>('/api/trips', { method: 'POST', body }),
    onSuccess: (t) => navigate(`/trips/${t.id}`),
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    create.mutate({
      name: f.get('name'), startDate: f.get('startDate'), endDate: f.get('endDate'),
      destination: { name: place.p?.name ?? place.text, lat: place.p?.lat, lng: place.p?.lng },
    })
  }

  return (
    <Modal title="Create a trip" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label className="field">Trip name<input name="name" required maxLength={120} placeholder="Japan 2027"
          defaultValue={destination ? `${destination} trip` : undefined} /></label>
        <PlaceSearch label="Destination" initial={destination} onPick={(p, text) => setPlace({ p, text })} />
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <label className="field" style={{ flex: 1 }}>Start<input name="startDate" type="date" required /></label>
          <label className="field" style={{ flex: 1 }}>End<input name="endDate" type="date" required /></label>
        </div>
        {errorText(create.error)}
        <button className="btn btn-primary" disabled={create.isPending}>Create Trip</button>
      </form>
    </Modal>
  )
}

function DaySelect({ trip, value, name = 'day' }: { trip: Trip; value: number | null; name?: string }) {
  return (
    <label className="field">
      Day
      <select name={name} defaultValue={value ?? ''}>
        <option value="">Unscheduled (save as idea)</option>
        {Array.from({ length: trip.dayCount }, (_, i) => (
          <option key={i} value={i}>Day {i + 1} · {formatDay(dayDate(trip, i))}</option>
        ))}
      </select>
    </label>
  )
}

const dayValue = (f: FormData) => (f.get('day') === '' ? null : Number(f.get('day')))

function useSaveDestination(trip: Trip, id: string | null, onDone: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DestinationInput) =>
      api<Destination>(`/api/trips/${trip.id}/destinations${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['destinations', trip.id] })
      onDone()
    },
  })
}

/** Create a proposal, then close the form and open the proposal so the group can discuss it. */
export function useCreateProposal(trip: Trip, onClose: () => void) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: unknown) => api<Proposal>(`/api/trips/${trip.id}/proposals`, { method: 'POST', body }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['proposals', trip.id] })
      onClose()
      navigate(`/trips/${trip.id}/suggestions/${p.id}`)
    },
  })
}

export function AddDestinationDialog({ trip, day, onClose }: { trip: Trip; day: number | null; onClose: () => void }) {
  const [place, setPlace] = useState<{ p: Place | null; text: string }>({ p: null, text: '' })
  const save = useSaveDestination(trip, null, onClose)
  const propose = useCreateProposal(trip, onClose)
  const proposeIt = (form: HTMLFormElement) => {
    if (!form.reportValidity()) return
    const f = new FormData(form)
    const name = place.p?.name ?? place.text
    propose.mutate({ title: `Add ${name}`, changes: [{ kind: 'ADD', name, address: place.p?.address, lat: place.p?.lat, lng: place.p?.lng,
      providerId: place.p?.providerId, durationMin: Number(f.get('duration')) || null, dayIndex: dayValue(f) }] })
  }
  const bias = trip.cities.find((c) => c.lat != null)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate({
      name: place.p?.name ?? place.text, address: place.p?.address ?? null, lat: place.p?.lat ?? null, lng: place.p?.lng ?? null,
      providerId: place.p?.providerId ?? null, notes: null, durationMin: Number(f.get('duration')) || null,
      dayIndex: dayValue(f), startTime: null, locked: false, flexibility: 'FLEXIBLE',
    })
  }

  return (
    <Modal title="Add destination" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PlaceSearch label="Place" bias={bias} required={!place.p} onPick={(p, text) => setPlace({ p, text })} />
        <LinkImport trip={trip} onPick={(p) => setPlace({ p, text: p.name })} />
        {place.p && <p role="status" style={{ margin: 0, fontSize: 14 }}>Selected: <strong>{place.p.name}</strong>{place.p.address && ` · ${place.p.address}`}</p>}
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2 }}><DaySelect trip={trip} value={day} /></div>
          <label className="field" style={{ flex: 1 }}>Minutes<input name="duration" type="number" min={5} max={1440} defaultValue={60} /></label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Adding to a day doesn’t move anything else. Optimize only runs when you ask.</p>
        {errorText(save.error ?? propose.error)}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {/* Proposing only means something when there's a group to weigh in. */}
          {trip.members.length > 1 && (
            <button type="button" className="btn" disabled={propose.isPending} onClick={(e) => proposeIt(e.currentTarget.form!)}>Propose to Group</button>
          )}
          <button className="btn btn-primary" disabled={save.isPending}>{trip.members.length > 1 ? 'Add Directly' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function EditDestinationDialog({ trip, dest, onClose, onMoreLikeThis }: {
  trip: Trip; dest: Destination; onClose: () => void; onMoreLikeThis?: () => void
}) {
  const qc = useQueryClient()
  const save = useSaveDestination(trip, dest.id, onClose)
  const remove = useMutation({
    mutationFn: () => api(`/api/trips/${trip.id}/destinations/${dest.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['destinations', trip.id] })
      onClose()
    },
  })
  const readOnly = trip.role === 'VIEWER'
  // A place added by name only (e.g. while search was down) can be put on the map here.
  const [located, setLocated] = useState<Place | null>(null)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate(toInput(dest, {
      ...(located && { lat: located.lat, lng: located.lng, address: located.address, providerId: located.providerId }),
      name: String(f.get('name')), dayIndex: dayValue(f), startTime: (f.get('startTime') as string) || null,
      durationMin: Number(f.get('duration')) || null, notes: (f.get('notes') as string) || null,
      locked: f.get('locked') === 'on', flexibility: f.get('flexibility') as Flexibility,
      visitAfter: (f.get('visitAfter') as string) || null, visitBefore: (f.get('visitBefore') as string) || null,
      dayTrip: f.get('dayTrip') === 'on',
    }))
  }

  return (
    <Modal title={dest.name} onClose={onClose}>
      {dest.address && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{dest.address}</p>}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="field">Name<input name="name" required maxLength={200} defaultValue={dest.name} /></label>
          {dest.lat == null && !readOnly && (
            <PlaceSearch label="Map location (not set yet)" initial={dest.name} required={false} onPick={(p) => setLocated(p)} />
          )}
          <DaySelect trip={trip} value={dest.dayIndex} />
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <label className="field" style={{ flex: 1 }}>Time<input name="startTime" type="time" defaultValue={dest.startTime?.slice(0, 5) ?? ''} /></label>
            <label className="field" style={{ flex: 1 }}>Minutes<input name="duration" type="number" min={5} max={1440} defaultValue={dest.durationMin ?? ''} /></label>
          </div>
          <label className="field">
            Flexibility
            <select name="flexibility" defaultValue={dest.flexibility}>
              <option value="FLEXIBLE">Flexible</option>
              <option value="PREFERRED">Preferred time</option>
              <option value="SAME_DAY">Same day</option>
              <option value="FIXED">Fixed</option>
            </select>
          </label>
          <label className="row" style={{ fontSize: 14, fontWeight: 600 }}>
            <input type="checkbox" name="locked" defaultChecked={dest.locked} style={{ width: 20, height: 20 }} />
            Lock it (AI will never move it)
          </label>
          <fieldset style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '10px 14px 14px', margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <legend style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', padding: '0 4px' }}>
              Best time to visit{dest.hintsSource === 'AI' && <span className="muted" style={{ fontWeight: 500 }}> · suggested by AI</span>}
            </legend>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <label className="field" style={{ flex: 1 }}>Not before<input name="visitAfter" type="time" defaultValue={dest.visitAfter?.slice(0, 5) ?? ''} /></label>
              <label className="field" style={{ flex: 1 }}>Done by<input name="visitBefore" type="time" defaultValue={dest.visitBefore?.slice(0, 5) ?? ''} /></label>
            </div>
            <label className="row" style={{ fontSize: 14, fontWeight: 600 }}>
              <input type="checkbox" name="dayTrip" defaultChecked={dest.dayTrip} style={{ width: 20, height: 20 }} />
              Day trip (gets a day of its own)
            </label>
          </fieldset>
          <label className="field">Notes<textarea name="notes" rows={3} maxLength={2000} defaultValue={dest.notes ?? ''} /></label>
        </fieldset>
        {errorText(save.error ?? remove.error)}
        {onMoreLikeThis && (
          <button type="button" className="btn btn-soft" style={{ alignSelf: 'flex-start' }} onClick={onMoreLikeThis}>More like this</button>
        )}
        {!readOnly && (
          <div className="spread">
            <button type="button" className="btn btn-ghost" onClick={() => remove.mutate()}>Remove</button>
            <button className="btn btn-primary" disabled={save.isPending}>Save</button>
          </div>
        )}
      </form>
    </Modal>
  )
}

export function InviteDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const create = useMutation({ mutationFn: () => api<{ token: string }>(`/api/trips/${trip.id}/invites`, { method: 'POST' }) })
  const revoke = useMutation({ mutationFn: () => api(`/api/trips/${trip.id}/invites`, { method: 'DELETE' }) })
  const url = create.data && `${window.location.origin}/join/${create.data.token}`

  return (
    <Modal title="Invite to this trip" onClose={onClose}>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>Anyone with the link can join as an editor for 30 days. No account connections needed.</p>
      {url ? (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input aria-label="Invite link" readOnly value={url} onFocus={(e) => e.target.select()}
            style={{ flex: 1, minHeight: 44, border: '1.5px solid var(--line-2)', borderRadius: 12, padding: '0 12px' }} />
          <button className="btn btn-primary" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>Create invite link</button>
      )}
      {errorText(create.error ?? revoke.error)}
      {trip.role === 'OWNER' && (
        <div className="spread" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <span className="muted" style={{ fontSize: 13 }}>{revoke.isSuccess ? 'All links turned off.' : 'Shared a link by mistake?'}</span>
          <button className="btn btn-ghost" disabled={revoke.isPending} onClick={() => { revoke.mutate(); create.reset() }}>Turn off all links</button>
        </div>
      )}
    </Modal>
  )
}
