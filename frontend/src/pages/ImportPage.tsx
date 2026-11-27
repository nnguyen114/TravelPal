import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { ApiError, api, readEvents } from '../api'
import { KIND, canEdit, dayColor, daysBetween, entrySummary, formatDay, formatRange, formatShort, shiftDate } from '../trip'
import type { Draft, DraftItem, EntryDetails, ImportResult, Place, Trip } from '../types'
import { TopBar } from './Dashboard'

const MAX_TEXT = 20_000
const MAX_PDF = 10 * 1024 * 1024
const MAX_DAYS = 60

/** One reviewable line of the plan. pick: the chosen map match, or -1 to keep the place without a map pin. */
type Row = {
  key: string; date: string | null; kind: DraftItem['kind']; title: string; time: string | null; note: string | null
  dayTrip: boolean; candidates: Place[]; pick: number; lock: boolean; details: EntryDetails; source: string | null
}
type Review = { name: string; start: string; end: string; cities: Draft['cities']; rows: Row[]; extend: boolean }

const rowKey = (date: string | null, i: number) => `${date ?? 'undated'}-${i}`

function toRow(it: DraftItem, date: string | null, i: number): Row {
  return {
    key: rowKey(date, i), date, kind: it.kind, title: it.title, time: it.time, note: it.note ?? null, dayTrip: !!it.day_trip,
    candidates: it.candidates ?? [], pick: it.candidates?.length ? 0 : -1, lock: !!it.time, details: it.details ?? {}, source: it.source,
  }
}

function toReview(d: Draft): Review {
  const rows = [...d.days.flatMap((day) => day.items.map((it, i) => toRow(it, day.date, i))), ...d.undated.map((it, i) => toRow(it, null, i))]
  return { name: d.name, start: d.days[0]?.date ?? '', end: d.days.at(-1)?.date ?? '', cities: d.cities, rows, extend: true }
}

/** The apply request for the reviewed rows. Positions follow the plan's order within each day. */
function applyBody(r: Review, importId: string, trip: Trip | undefined) {
  const order = new Map<string | null, number>()
  const position = (date: string | null) => {
    const n = order.get(date) ?? 0
    order.set(date, n + 1)
    return n
  }
  const places: unknown[] = []
  const entries: unknown[] = []
  for (const row of r.rows) {
    const at = { date: row.date, position: position(row.date) }
    if (row.kind === 'PLACE') {
      const c = row.candidates[row.pick]
      places.push({ ...at, name: row.title, address: c?.address || null, lat: c?.lat ?? null, lng: c?.lng ?? null, providerId: c?.providerId ?? null,
        startTime: row.time, locked: row.lock && !!row.time, notes: row.note, dayTrip: row.dayTrip })
    } else {
      entries.push({ ...at, kind: row.kind, title: row.title, startTime: row.time, details: row.details, source: row.source })
    }
  }
  if (trip) {
    const last = latest(r)
    return { importId, tripId: trip.id, extendEndTo: r.extend && last && last > trip.endDate ? last : null, places, entries }
  }
  // City dates have to sit inside the trip; drop them if the traveler moved the trip's dates past them.
  const cities = r.cities.filter((c) => c.name.trim()).map((c) => {
    const s = c.startDate && c.startDate < r.start ? r.start : c.startDate
    const e = c.endDate && c.endDate > r.end ? r.end : c.endDate
    const ok = s && e && s <= e
    return { name: c.name.trim(), lat: c.lat, lng: c.lng, startDate: ok ? s : null, endDate: ok ? e : null }
  })
  return { importId, newTrip: { name: r.name, startDate: r.start, endDate: r.end, cities }, places, entries }
}

const latest = (r: Review) => r.rows.map((x) => x.date).filter((d): d is string => !!d).sort().at(-1) ?? null

/** Paste a plan or upload a PDF, review what TravelPal understood, then apply it in one step. Nothing is saved before Apply. */
export function ImportPage() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => api<Trip>(`/api/trips/${tripId}`), enabled: !!tripId })
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const importId = useRef('')
  const heading = useRef<HTMLHeadingElement>(null)

  // Unsaved review: ask before leaving, inside the app and when closing or reloading the tab.
  const applied = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    review !== null && !applied.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (confirm('Leave without importing? Your review will be lost.')) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  useEffect(() => {
    if (!review) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [review])

  const read = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      if (file) form.set('file', file)
      else form.set('text', text)
      if (tripId) form.set('tripId', tripId)
      // A stream, so a long read keeps its connection: status events until the draft, or an error, arrives.
      let draft: Draft | undefined
      await readEvents('/api/imports/read', (name, data) => {
        if (name === 'draft') draft = JSON.parse(data)
        if (name === 'error') {
          const e = JSON.parse(data) as { status: number; message: string }
          throw new ApiError(e.status, e.message)
        }
      }, new AbortController().signal, form)
      if (!draft) throw new Error('The connection dropped. Try again.')
      return draft
    },
    onSuccess: (d) => {
      importId.current = crypto.randomUUID()
      setDraft(d)
      setReview(toReview(d))
    },
  })
  useEffect(() => {
    if (!read.isPending) return
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [read.isPending])
  useEffect(() => {
    if (draft) heading.current?.focus()
  }, [draft])

  const apply = useMutation({
    mutationFn: () => api<ImportResult>('/api/imports/apply', { method: 'POST', body: applyBody(review!, importId.current, trip.data) }),
    onSuccess: (r) => {
      applied.current = true
      navigate(`/trips/${r.tripId}`, { state: { imported: r } })
    },
  })

  function start() {
    setInputError(null)
    if (file && text.trim()) return setInputError('Paste your plan or choose a PDF, not both.')
    if (!file && !text.trim()) return setInputError('Paste your plan or choose a PDF first.')
    if (text.length > MAX_TEXT) return setInputError('That’s more than 20,000 characters. Paste a shorter part of the plan.')
    if (file && file.type !== 'application/pdf') return setInputError('That file isn’t a PDF.')
    if (file && file.size > MAX_PDF) return setInputError('PDFs can be up to 10 MB.')
    setSlow(false)
    read.mutate()
  }

  const readError = read.error && (read.error instanceof ApiError && read.error.status === 413 ? 'PDFs can be up to 10 MB.' : read.error.message)
  if (tripId && trip.data && !canEdit(trip.data)) {
    return <><TopBar /><main className="page import-page"><div role="alert" className="error">Only editors can import into this trip.</div></main></>
  }
  const back = tripId ? `/trips/${tripId}` : '/trips'
  return (
    <>
      <TopBar />
      <main className="page import-page" style={{ maxWidth: 860 }}>
        <nav aria-label="Breadcrumb" className="muted" style={{ fontSize: 13 }}>
          <Link to={back} style={{ textDecoration: 'none' }}>{trip.data?.name ?? 'My Trips'}</Link> <span aria-hidden="true">›</span> Import itinerary
        </nav>
        {!review ? (
          <section aria-labelledby="import-title" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <h1 id="import-title" style={{ fontSize: 32, fontWeight: 800 }}>Import itinerary</h1>
            <p className="muted" style={{ margin: 0 }}>
              Paste your plan or upload a PDF. You'll see what we understood and can fix anything before it's added{trip.data ? ` to ${trip.data.name}` : ' as a new trip'}.
            </p>
            <label className="field">
              Paste your plan
              <textarea rows={14} value={text} disabled={read.isPending} onChange={(e) => setText(e.target.value)}
                placeholder={'DEC 24\nFlight LAX → HND\nDEC 25\nCheck in hotel\nDinner (Asakusa)'} />
            </label>
            <span className="muted" style={{ fontWeight: 500, fontSize: 13, marginTop: -10 }}>{text.length.toLocaleString()} / 20,000 characters</span>
            <label className="field">
              Or upload a PDF (up to 10 MB, 30 pages)
              <input type="file" accept="application/pdf" disabled={read.isPending} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {(inputError || readError) && <div role="alert" className="error">{inputError ?? readError}</div>}
            <div className="row">
              <button className="btn btn-primary" disabled={read.isPending} onClick={start}>Read my plan</button>
              {read.isPending && <span role="status" className="muted">{slow ? 'Finding places…' : 'Reading your plan…'}</span>}
            </div>
          </section>
        ) : (
          <ReviewForm heading={heading} draft={draft!} review={review} setReview={setReview} trip={trip.data}
            onApply={() => apply.mutate()} applying={apply.isPending} error={apply.error?.message ?? null} />
        )}
      </main>
    </>
  )
}

type Blocker = { key: string | null; message: string }

function ReviewForm({ heading, draft, review, setReview, trip, onApply, applying, error }: {
  heading: RefObject<HTMLHeadingElement | null>; draft: Draft; review: Review; setReview: (r: Review) => void; trip: Trip | undefined
  onApply: () => void; applying: boolean; error: string | null
}) {
  const r = review
  const set = (patch: Partial<Review>) => setReview({ ...r, ...patch })
  const setRow = (key: string, patch: Partial<Row>) => set({ rows: r.rows.map((x) => (x.key === key ? { ...x, ...patch } : x)) })
  const start = trip?.startDate ?? r.start
  const last = latest(r)
  const end = trip ? (r.extend && last && last > trip.endDate ? last : trip.endDate) : r.end

  const blockers: Blocker[] = []
  if (!trip && !r.cities.some((c) => c.name.trim())) {
    blockers.push({ key: null, message: 'Add at least one base city, like Tokyo.' })
  }
  if (!trip && (!r.start || !r.end || r.end < r.start || daysBetween(r.start, r.end) >= MAX_DAYS)) {
    blockers.push({ key: null, message: `Set the trip's start and end dates (at most ${MAX_DAYS} days).` })
  }
  for (const x of r.rows) {
    if (x.date && start && end && (x.date < start || x.date > end)) {
      blockers.push({ key: x.key, message: `“${x.title}” is on ${formatShort(x.date)}, outside the trip. Move it or remove it.` })
    }
  }
  const keys = new Set(r.rows.map((x) => x.key))
  const issues = draft.issues.filter((i) => i.item === null || keys.has(rowKey(i.date, i.item)))
  const open = r.rows.filter((x) => x.kind === 'CHOICE')

  // Changing the start date moves every day with it (e.g. fixing an assumed year).
  function moveStart(to: string) {
    if (!to) return
    if (!r.start) return set({ start: to })
    const by = daysBetween(r.start, to)
    set({ start: to, end: r.end && shiftDate(r.end, by), rows: r.rows.map((x) => ({ ...x, date: x.date && shiftDate(x.date, by) })),
      cities: r.cities.map((c) => ({ ...c, startDate: c.startDate && shiftDate(c.startDate, by), endDate: c.endDate && shiftDate(c.endDate, by) })) })
  }

  const dates = [...new Set(r.rows.map((x) => x.date).filter((d): d is string => !!d))].sort()
  const undated = r.rows.filter((x) => !x.date)
  const rowProps = { setRow, remove: (key: string) => set({ rows: r.rows.filter((x) => x.key !== key) }), min: start, max: end }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 8 }}>
      <h1 ref={heading} tabIndex={-1} style={{ fontSize: 32, fontWeight: 800 }}>Review your plan</h1>
      <p className="muted" style={{ margin: 0 }}>Nothing is saved yet. Fix anything we got wrong, then apply it in one step.</p>

      <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }} aria-labelledby="review-trip">
        <h2 id="review-trip" style={{ fontSize: 18, fontWeight: 800 }}>Trip</h2>
        {trip ? (
          <>
            <p style={{ margin: 0 }}><strong>{trip.name}</strong> · {formatRange(trip.startDate, trip.endDate)}</p>
            {last && last > trip.endDate && (
              <label className="row" style={{ fontSize: 14, fontWeight: 600 }}>
                <input type="checkbox" checked={r.extend} onChange={(e) => set({ extend: e.target.checked })} style={{ width: 20, height: 20 }} />
                Extend the trip to {formatShort(last)}
              </label>
            )}
          </>
        ) : (
          <>
            <label className="field">Trip name<input value={r.name} maxLength={120} required onChange={(e) => set({ name: e.target.value })} /></label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <label className="field" style={{ flex: 1 }}>Start<input type="date" value={r.start} onChange={(e) => moveStart(e.target.value)} /></label>
              <label className="field" style={{ flex: 1 }}>End<input type="date" value={r.end} min={r.start} onChange={(e) => set({ end: e.target.value })} /></label>
            </div>
            <label className="field">
              Base cities (comma-separated)
              <input value={r.cities.map((c) => c.name).join(', ')} onChange={(e) => {
                const names = e.target.value.split(',').map((s) => s.trimStart())
                set({ cities: names.map((n) => r.cities.find((c) => c.name === n.trim()) ?? { name: n, lat: null, lng: null, startDate: null, endDate: null }) })
              }} />
            </label>
          </>
        )}
      </section>

      {(issues.length > 0 || blockers.length > 0 || open.length > 0) && (
        <section className="card issues" style={{ padding: 20, background: 'var(--warn-bg)' }} aria-labelledby="review-issues">
          <h2 id="review-issues" style={{ fontSize: 18, fontWeight: 800 }}>Needs a look</h2>
          <ul role="status" style={{ margin: '10px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            {blockers.map((b, i) => <li key={`b${i}`}><Issue target={b.key}><strong>Must fix:</strong> {b.message}</Issue></li>)}
            {issues.map((i, n) => <li key={n}><Issue target={i.item === null ? null : rowKey(i.date, i.item)}>{i.message}</Issue></li>)}
            {open.map((x) => <li key={x.key}><Issue target={x.key}>Still to decide: {x.title}. It stays open after import.</Issue></li>)}
          </ul>
        </section>
      )}

      {dates.map((d, i) => (
        <section key={d} className="card day-card import-day" aria-labelledby={`review-${d}`} style={{ '--c': dayColor(i) } as CSSProperties}>
          <h2 id={`review-${d}`} style={{ fontSize: 18, fontWeight: 800 }}>{formatDay(d)}</h2>
          <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {r.rows.filter((x) => x.date === d).map((x) => <RowEditor key={x.key} row={x} {...rowProps} />)}
          </ol>
        </section>
      ))}
      {undated.length > 0 && (
        <section className="card import-day" aria-labelledby="review-undated">
          <h2 id="review-undated" style={{ fontSize: 18, fontWeight: 800 }}>Undated</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>These import as ideas or notes. Give one a date to put it on a day.</p>
          <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {undated.map((x) => <RowEditor key={x.key} row={x} {...rowProps} />)}
          </ol>
        </section>
      )}

      {error && <div role="alert" className="error">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={blockers.length > 0 || applying || r.rows.length === 0} onClick={onApply}>
          {applying ? 'Applying…' : trip ? `Apply to ${trip.name}` : 'Apply as a new trip'}
        </button>
      </div>
    </div>
  )
}

/** A link from "Needs a look" to the row it's about. */
function Issue({ target, children }: { target: string | null; children: ReactNode }) {
  if (!target) return <>{children}</>
  return (
    <a href={`#row-${target}`} onClick={(e) => {
      e.preventDefault()
      const el = document.getElementById(`row-${target}`)
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      el?.focus()
    }}>{children}</a>
  )
}

function RowEditor({ row, setRow, remove, min, max }: {
  row: Row; setRow: (key: string, patch: Partial<Row>) => void; remove: (key: string) => void; min: string; max: string
}) {
  const [showSource, setShowSource] = useState(false)
  const patch = (p: Partial<Row>) => setRow(row.key, p)
  const [icon, label] = KIND[row.kind]
  const name = row.title || label
  const options = row.details.options ?? []
  return (
    <li id={`row-${row.key}`} tabIndex={-1} className="stop import-row">
      <span className="entry-icon" aria-hidden="true">{icon}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="sr-only">{label}</span>
          <input className="title-input" aria-label={`Title (${label})`} value={row.title} maxLength={200} onChange={(e) => patch({ title: e.target.value })} />
          <input type="time" aria-label={`Time for ${name}`} value={row.time ?? ''} onChange={(e) => {
            const time = e.target.value || null
            // A time the traveler adds is one they mean to keep; an explicit unlock on a timed row stays.
            patch(row.time ? { time } : { time, lock: !!time })
          }} />
          <input type="date" aria-label={`Date for ${name}`} value={row.date ?? ''} min={min || undefined} max={max || undefined}
            onChange={(e) => patch({ date: e.target.value || null })} />
          {(row.kind === 'PLACE' || row.kind === 'NOTE') && (
            <select aria-label={`Kind of ${name}`} value={row.kind} onChange={(e) => patch({ kind: e.target.value as Row['kind'], details: {} })}>
              <option value="PLACE">Place</option>
              <option value="NOTE">Note</option>
            </select>
          )}
        </div>
        {row.kind === 'PLACE' && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
            <legend className="sr-only">Map match for {name}</legend>
            {row.candidates.map((c, i) => (
              <label key={c.providerId} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <input type="radio" name={`pick-${row.key}`} checked={row.pick === i} onChange={() => patch({ pick: i })} />
                <span><strong>{c.name}</strong>{c.address && <span className="muted"> · {c.address}</span>}</span>
              </label>
            ))}
            <label className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <input type="radio" name={`pick-${row.key}`} checked={row.pick === -1} onChange={() => patch({ pick: -1 })} />
              <span>{row.candidates.length ? 'Keep as an idea without a map pin' : 'No map match found. Keep it without a map pin'}</span>
            </label>
            {row.time && (
              <label className="row" style={{ gap: 8, fontWeight: 600 }}>
                <input type="checkbox" checked={row.lock} onChange={(e) => patch({ lock: e.target.checked })} />
                Lock time
              </label>
            )}
            {(row.note || row.dayTrip) && <span className="muted">{[row.dayTrip && 'Day trip', row.note].filter(Boolean).join(' · ')}</span>}
          </fieldset>
        )}
        {row.kind === 'CHOICE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {options.map((o, i) => (
              <div key={i} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <input aria-label={`Option ${i + 1} of ${name}`} value={o.label} maxLength={200} style={{ flex: 1 }}
                  onChange={(e) => patch({ details: { ...row.details, options: options.map((x, j) => (j === i ? { ...x, label: e.target.value, place: null } : x)) } })} />
                <button type="button" className="btn btn-soft" aria-label={`Remove option ${o.label}`} disabled={options.length <= 1}
                  onClick={() => patch({ details: { ...row.details, options: options.filter((_, j) => j !== i) } })}>Remove</button>
              </div>
            ))}
            <span className="muted" style={{ fontSize: 13 }}>Stays open after import: choose one on the trip.</span>
          </div>
        )}
        {row.kind !== 'PLACE' && row.kind !== 'CHOICE' && entrySummary(row.kind, row.details, row.date) && (
          <span className="muted" style={{ fontSize: 14 }}>{entrySummary(row.kind, row.details, row.date)}</span>
        )}
        {row.source && (
          <div>
            <button type="button" className="btn btn-soft" aria-expanded={showSource} onClick={() => setShowSource((s) => !s)}>
              {showSource ? 'Hide source' : 'Show source'}
            </button>
            {showSource && <pre className="source">{row.source}</pre>}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-soft" aria-label={`Remove ${name}`} onClick={() => remove(row.key)}>Remove</button>
    </li>
  )
}
