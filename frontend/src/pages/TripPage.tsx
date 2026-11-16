import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { AddDestinationDialog, EditDestinationDialog, InviteDialog } from '../dialogs'
import { LinkIcon, LockIcon, Logo, PlusIcon, SparkleIcon } from '../icons'
import { useTripLive } from '../live'
import { Empty } from '../art'
import { AskAiButton, AssistantDrawer } from '../assistant'
import { PaceSwitch, useOptimize } from '../optimize'
import { bestTime, byDay, canEdit, cityForDay, countdown, dayColor, dayDate, formatDay, formatDuration, formatRange, freeTime, toInput } from '../trip'
import { DiscoverSheet, type DiscoverAsk } from '../discover'
import type { Destination, Mode, Trip } from '../types'
import { SuggestionsTab, useProposalCounts } from './Suggestions'
import { ActivityTab, MembersTab } from './CollabTabs'

type Tab = 'main' | 'destinations' | 'suggestions' | 'members' | 'activity'
const TABS: [Tab, string, string][] = [['main', 'Main Trip', ''], ['destinations', 'Destinations', '/destinations'],
  ['suggestions', 'Suggestions', '/suggestions'], ['members', 'Members', '/members'], ['activity', 'Activity', '/activity']]

const TripMap = lazy(() => import('../map/TripMap').then((m) => ({ default: m.TripMap })))
const AVATAR_BG = ['#FFD9A8', '#BFE6E1', '#D9D4FB', '#FDE7DF']

function TripHeader({ trip, tab, openProposals }: { trip: Trip; tab: Tab; openProposals: number }) {
  const { user } = useAuth()
  // You're shown on the right (link to My Trips); the stack is everyone else.
  const others = trip.members.filter((m) => m.userId !== user?.id)
  const shown = others.slice(0, 3)
  const [inviting, setInviting] = useState(false)
  const [today] = useState(() => new Date())
  return (
    <header className="topbar trip-head">
      <div className="topbar-inner" style={{ paddingBottom: 0, flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="spread">
          <div className="row" style={{ gap: 14 }}>
            <Link to="/" aria-label="TravelPal home"><Logo /></Link>
            <div>
              <nav aria-label="Breadcrumb" style={{ fontSize: 13 }} className="muted">
                <Link to="/trips" style={{ textDecoration: 'none' }}>My Trips</Link> <span aria-hidden="true">›</span> {trip.name}
              </nav>
              <h1 style={{ marginTop: 2, fontSize: 24, fontWeight: 800 }}>{trip.name}</h1>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="pill pill-date">{formatRange(trip.startDate, trip.endDate)}</span>
              {trip.cities.map((c) => <span key={c.id} className="pill pill-city">{c.name}{c.locked && <LockIcon />}</span>)}
              <span className="pill pill-soon">{countdown(trip.startDate, trip.endDate, today)}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <div style={{ display: 'flex' }} aria-label={`${trip.members.length} members`}>
              {shown.map((m, i) => (
                <span key={m.userId} className="avatar" title={m.displayName} style={{ background: AVATAR_BG[i], marginLeft: i ? -8 : 0 }}>
                  {m.displayName.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {others.length > 3 && <span className="avatar" style={{ background: 'var(--soft)', marginLeft: -8 }}>+{others.length - 3}</span>}
            </div>
            {canEdit(trip) && <button className="btn" onClick={() => setInviting(true)}><LinkIcon /> Invite</button>}
            <Link to="/trips" className="me-link" title="My Trips">
              <span className="avatar" aria-hidden="true">{user?.displayName.slice(0, 1).toUpperCase()}</span>
              <span>{user?.displayName}</span>
            </Link>
          </div>
        </div>
        <nav aria-label="Trip sections" className="tabs">
          {TABS.map(([t, label, path]) => (
            <Link key={t} to={`/trips/${trip.id}${path}`} aria-current={tab === t ? 'page' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {label}
              {t === 'suggestions' && openProposals > 0 && (
                <span aria-label={`${openProposals} open`} style={{ background: '#FDE7DF', color: '#A9412A', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>{openProposals}</span>
              )}
            </Link>
          ))}
        </nav>
      </div>
      {inviting && <InviteDialog trip={trip} onClose={() => setInviting(false)} />}
    </header>
  )
}

/**
 * How much of the top of the screen the sticky trip header (and, on narrow screens, the sticky map) covers, kept in
 * --trip-head / --trip-stack so the map sits under the header and a picked day scrolls into view below both.
 */
function useStickyStack(mapPanel: { current: HTMLElement | null }) {
  const [stack, setStack] = useState(0)
  useEffect(() => {
    const head = document.querySelector<HTMLElement>('.trip-head')
    const root = document.documentElement.style
    const covered = (el: HTMLElement | null) => (el && getComputedStyle(el).position === 'sticky' ? el.offsetHeight : 0)
    const update = () => {
      const h = covered(head)
      // The map only covers the itinerary when it spans the page above it (narrow screens); beside it, it doesn't.
      const m = mapPanel.current && mapPanel.current.offsetWidth > window.innerWidth / 2 ? covered(mapPanel.current) : 0
      root.setProperty('--trip-head', `${h}px`)
      root.setProperty('--trip-stack', `${h + m}px`)
      setStack(h + m)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    for (const el of [head, mapPanel.current, document.body]) if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [mapPanel])
  return stack
}

function useReorder(trip: Trip) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ day, ids }: { day: number; ids: string[] }) =>
      api(`/api/trips/${trip.id}/days/${day}/order`, { method: 'PUT', body: { ids } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['destinations', trip.id] }),
  })
}

function DayCard({ trip, index, stops, active, selectedId, onSelect, onAdd, onEdit, onOptimize, onFindMore }: {
  trip: Trip; index: number; stops: Destination[]; active: boolean; selectedId: string | null
  onSelect: (id: string) => void; onAdd: () => void; onEdit: (d: Destination) => void; onOptimize: () => void
  onFindMore: (free: string) => void
}) {
  const free = stops.length > 0 ? freeTime(stops) : null
  const date = dayDate(trip, index)
  const color = dayColor(index)
  const reorder = useReorder(trip)
  const editable = canEdit(trip)

  function move(i: number, by: number) {
    const ids = stops.map((s) => s.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    reorder.mutate({ day: index, ids })
  }

  const city = cityForDay(trip.cities, date)?.name
  if (stops.length === 0) {
    // Long trips have many open days: keep them to one slim row each so the planned days stand out.
    return (
      <article className="card day-card day-empty" data-day={index} data-active={active} aria-labelledby={`day-${index}`} style={{ '--c': color } as CSSProperties}>
        <span className="dot" style={{ width: 10, height: 10, background: color }} aria-hidden="true" />
        <h2 id={`day-${index}`}>Day {index + 1}</h2>
        <span className="muted day-empty-date">{formatDay(date)}{city && ` · ${city}`}</span>
        <span className="muted day-empty-note">Nothing planned yet.</span>
        {editable && <button className="btn btn-soft" onClick={onAdd} aria-label={`Add a place to Day ${index + 1}`}>+ Add</button>}
      </article>
    )
  }

  return (
    <article className="card day-card" data-day={index} data-active={active} aria-labelledby={`day-${index}`} style={{ '--c': color } as CSSProperties}>
      <div className="spread">
        <div className="row">
          <span className="dot" style={{ width: 12, height: 12, background: color }} aria-hidden="true" />
          <h2 id={`day-${index}`} style={{ fontSize: 18, fontWeight: 800 }}>Day {index + 1}</h2>
          <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>{formatDay(date)} · {cityForDay(trip.cities, date)?.name}</span>
        </div>
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{stops.length} {stops.length === 1 ? 'stop' : 'stops'}</span>
      </div>
      <ol style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stops.map((s, i) => (
          <li key={s.id} className="stop" data-selected={s.id === selectedId} data-stop={s.id}>
            <span className="num" style={{ background: color }}>{i + 1}</span>
            <span style={{ width: 52, flex: 'none', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.startTime?.slice(0, 5) ?? '—'}</span>
            <button className="stop-main" onClick={() => onSelect(s.id)} onDoubleClick={() => onEdit(s)}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{s.name}</span>
              <span className="muted" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>
                {[s.address?.split(',')[0], s.durationMin && `about ${formatDuration(s.durationMin)}`, bestTime(s),
                  s.lat == null && 'not on the map yet'].filter(Boolean).join(' · ')}
              </span>
            </button>
            <span className="stop-actions">
              {s.locked && <span className="pill pill-warn"><LockIcon /> Locked</span>}
              {editable && (
                <>
                  <button className="icon-btn" aria-label={`Move ${s.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>↑</button>
                  <button className="icon-btn" aria-label={`Move ${s.name} down`} disabled={i === stops.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>↓</button>
                </>
              )}
              <button className="btn btn-soft" onClick={() => onEdit(s)}>{editable ? 'Edit' : 'Details'}</button>
            </span>
          </li>
        ))}
      </ol>
      {free && (
        <div className="free-time">
          <span><strong>Free time</strong> · {free.from} – {free.to}, nothing planned</span>
          <button className="btn-ghost" style={{ border: 0, background: 'none', color: 'var(--accent)', fontWeight: 700, minHeight: 44 }}
            onClick={() => onFindMore(`${free.from} – ${free.to}`)}>Find More Places</button>
        </div>
      )}
      {editable && (
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn btn-soft" onClick={onAdd}>+ Add</button>
          {stops.length > 1 && <button className="btn btn-soft" onClick={onOptimize}>Optimize Day</button>}
        </div>
      )}
    </article>
  )
}

/** The map position of the city a day happens in, if that city has one. */
function cityPoint(trip: Trip, day: number): [number, number] | undefined {
  const c = cityForDay(trip.cities, dayDate(trip, day))
  return c?.lat != null && c.lng != null ? [c.lng, c.lat] : undefined
}

const CHIPS_UP_TO = 5

/** Which day the map shows: chips for short trips, a compact stepper with a menu for long ones. */
function DayPicker({ trip, days, active, onPick }: {
  trip: Trip; days: Destination[][]; active: number | null; onPick: (day: number | null) => void
}) {
  if (days.length <= CHIPS_UP_TO) {
    return (
      <div className="row" style={{ gap: 8 }} role="group" aria-label="Show day on map">
        {days.map((_, i) => (
          <button key={i} className="day-chip" aria-pressed={active === i} onClick={() => onPick(i)}>
            <span className="dot" style={{ background: dayColor(i) }} aria-hidden="true" />Day {i + 1}
          </button>
        ))}
        <button className="day-chip" aria-pressed={active === null} onClick={() => onPick(null)}>All days</button>
      </div>
    )
  }
  const last = days.length - 1
  const at = active ?? -1
  return (
    <div className="day-picker" role="group" aria-label="Show day on map">
      <button className="icon-btn day-step" aria-label="Previous day" disabled={at <= 0} onClick={() => onPick(at - 1)}>‹</button>
      <label className="day-select" style={{ '--c': active === null ? 'var(--muted)' : dayColor(active) } as CSSProperties}>
        <span className="dot" aria-hidden="true" />
        <span className="sr-only">Day shown on map</span>
        <select value={active ?? 'all'} onChange={(e) => onPick(e.target.value === 'all' ? null : Number(e.target.value))}>
          <option value="all">All days · {days.flat().length} places</option>
          {days.map((stops, i) => (
            <option key={i} value={i}>
              Day {i + 1} · {formatDay(dayDate(trip, i))}{stops.length ? ` · ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}` : ''}
            </option>
          ))}
        </select>
      </label>
      <button className="icon-btn day-step" aria-label="Next day" disabled={at >= last} onClick={() => onPick(at + 1)}>›</button>
      <button className="day-chip" aria-pressed={active === null} onClick={() => onPick(null)}>All days</button>
    </div>
  )
}

function Itinerary({ trip, destinations }: { trip: Trip; destinations: Destination[] }) {
  const days = useMemo(() => byDay(trip, destinations), [trip, destinations])
  const [mode, setMode] = useState<Mode>('BALANCED')
  const optimize = useOptimize(trip.id)
  const unscheduled = destinations.filter((d) => d.dayIndex === null).length
  const [activeDay, setActiveDay] = useState<number | null>(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState<number | null | undefined>(undefined)
  const [editing, setEditing] = useState<Destination | null>(null)
  const [discover, setDiscover] = useState<DiscoverAsk | null>(null)
  const list = useRef<HTMLElement>(null)
  const mapPanel = useRef<HTMLElement>(null)
  const stack = useStickyStack(mapPanel)
  // After someone picks a day, the scroll that brings it into view mustn't hand the map to its neighbour.
  const pickedAt = useRef(0)

  // As day sections scroll past, the map follows the one at the top of the viewport.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top && performance.now() - pickedAt.current > 1200) setActiveDay(Number((top.target as HTMLElement).dataset.day))
    }, { rootMargin: `-${stack + 8}px 0px -55% 0px` })
    list.current?.querySelectorAll('[data-day]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [days.length, stack])

  /** Show a day on the map and bring it into view in the itinerary. */
  function pickDay(day: number | null) {
    pickedAt.current = performance.now()
    setActiveDay(day)
    if (day !== null) list.current?.querySelector(`[data-day="${day}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function selectFromMap(id: string) {
    setSelectedId(id)
    list.current?.querySelector(`[data-stop="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const firstCity = trip.cities.find((c) => c.lat != null)
  return (
    <main className="workspace">
      <section ref={list} aria-label="Itinerary" className="itinerary">
        <div className="spread">
          {canEdit(trip)
            ? <PaceSwitch value={mode} onChange={setMode} />
            : <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}>{trip.dayCount} days · {destinations.length} places</span>}
          {canEdit(trip) && (
            <div className="row" style={{ gap: 10 }}>
              <button className="btn" onClick={() => setAdding(activeDay)}><PlusIcon /> Add Destination</button>
              <button className="btn btn-primary" disabled={optimize.isPending || destinations.length === 0}
                onClick={() => optimize.mutate({ mode, scope: 'TRIP' })}><SparkleIcon /> Optimize Trip</button>
            </div>
          )}
        </div>
        {optimize.error && <div role="alert" className="error">{optimize.error.message}</div>}
        {destinations.length === 0 && (
          <div className="card" style={{ padding: 22 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>Start with the places you want to go</h2>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
              Add them one at a time, or paste a whole list into <strong>Ask AI</strong>. Then Optimize Trip sorts them into days.
            </p>
          </div>
        )}
        {days.map((stops, i) => (
          <DayCard key={i} trip={trip} index={i} stops={stops} active={activeDay === i} selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setActiveDay(i) }} onAdd={() => setAdding(i)} onEdit={setEditing}
            onOptimize={() => optimize.mutate({ mode, scope: 'DAY', dayIndex: i })}
            onFindMore={(free) => setDiscover({ dayIndex: i, context: `Near Day ${i + 1} · free ${free}` })} />
        ))}
        {unscheduled > 0 && (
          <div className="spread" style={{ background: 'var(--accent-soft)', borderRadius: 20, padding: '18px 22px' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{unscheduled} unscheduled {unscheduled === 1 ? 'place' : 'places'}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>Saved ideas stay here until you add them to a day.</div>
            </div>
            <Link to={`/trips/${trip.id}/destinations`} style={{ fontWeight: 700, fontSize: 14, minHeight: 44, display: 'flex', alignItems: 'center' }}>View in Destinations</Link>
          </div>
        )}
      </section>

      <section ref={mapPanel} aria-label="Map" className="card map-panel">
        <DayPicker trip={trip} days={days} active={activeDay} onPick={pickDay} />
        <div className="map-box">
          <Suspense fallback={null}>
            <TripMap days={days.map((stops, i) => ({ color: dayColor(i), stops, home: cityPoint(trip, i) }))} activeDay={activeDay} selectedId={selectedId}
              onSelect={selectFromMap} center={firstCity ? [firstCity.lng!, firstCity.lat!] : undefined} />
          </Suspense>
          <div className="map-note">
            <svg width="34" height="8" viewBox="0 0 34 8" aria-hidden="true"><path d="M2 4 L32 4" stroke="#14A098" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" /></svg>
            <span>Dotted lines show visit order, not walking routes or travel times.</span>
          </div>
        </div>
      </section>

      {adding !== undefined && <AddDestinationDialog trip={trip} day={adding} onClose={() => setAdding(undefined)} />}
      {editing && <EditDestinationDialog trip={trip} dest={editing} onClose={() => setEditing(null)} onMoreLikeThis={() => {
        setDiscover({ dayIndex: editing.dayIndex, like: { id: editing.id, name: editing.name }, context: `More like ${editing.name}` })
        setEditing(null)
      }} />}
      {discover && <DiscoverSheet trip={trip} ask={discover} onClose={() => setDiscover(null)} />}
    </main>
  )
}

type Filter = 'all' | 'scheduled' | 'unscheduled'

function DestinationsTab({ trip, destinations }: { trip: Trip; destinations: Destination[] }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Destination | null>(null)
  const [discover, setDiscover] = useState<DiscoverAsk | null>(null)
  const schedule = useMutation({
    mutationFn: ({ d, day }: { d: Destination; day: number }) =>
      api(`/api/trips/${trip.id}/destinations/${d.id}`, { method: 'PUT', body: toInput(d, { dayIndex: day }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['destinations', trip.id] }),
  })
  const [mode, setMode] = useState<Mode>('BALANCED')
  const optimize = useOptimize(trip.id)
  const ideas = destinations.filter((d) => d.dayIndex === null)
  const shown = destinations.filter((d) => filter === 'all' || (filter === 'scheduled') === (d.dayIndex !== null))
  const count = (f: Filter) => destinations.filter((d) => f === 'all' || (f === 'scheduled') === (d.dayIndex !== null)).length

  return (
    <main className="page" style={{ maxWidth: 960, paddingTop: 24 }}>
      <div className="spread">
        <div className="segmented" role="group" aria-label="Filter destinations">
          {(['all', 'scheduled', 'unscheduled'] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} · {count(f)}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={() => setDiscover({ dayIndex: null, context: `Anywhere in ${trip.cities[0]?.name ?? 'the trip'}` })}>Find More Places</button>
          {canEdit(trip) && <button className="btn" onClick={() => setAdding(true)}><PlusIcon /> Add Destination</button>}
        </div>
      </div>
      {canEdit(trip) && ideas.length > 0 && (
        <section className="fit-ideas" aria-label="Fit ideas into days">
          <div>
            <strong>{ideas.length} {ideas.length === 1 ? 'idea isn\'t' : 'ideas aren\'t'} on a day yet</strong>
            <span>Fit them into the days by where they are. You'll see a preview before anything changes.</span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <PaceSwitch value={mode} onChange={setMode} />
            <button className="btn btn-primary" disabled={optimize.isPending}
              onClick={() => optimize.mutate({ mode, scope: 'SELECTION', destinationIds: ideas.map((d) => d.id) })}>
              <SparkleIcon /> Fit into days
            </button>
          </div>
        </section>
      )}
      {(schedule.error ?? optimize.error) && <div role="alert" className="error" style={{ marginTop: 16 }}>{(schedule.error ?? optimize.error)!.message}</div>}
      <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.length === 0 && <li><Empty title="No places here yet.">Add a few spots you're curious about. They can sit here until you decide on a day.</Empty></li>}
        {shown.map((d) => (
          <li key={d.id} className="card spread dest-row" style={d.dayIndex === null ? undefined : { '--c': dayColor(d.dayIndex) } as CSSProperties}>
            <button className="stop-main row" style={{ gap: 12, flexWrap: 'nowrap' }} onClick={() => setEditing(d)}>
              {/* Name first for screen readers; the day chip still shows first (CSS order). */}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700 }}>{d.name}</span>
                {(d.startTime || bestTime(d)) && (
                  <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                    {[d.startTime?.slice(0, 5), bestTime(d)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="sr-only">, </span>
              {d.dayIndex === null
                ? <span className="day-tag day-tag-idea">Idea</span>
                : <span className="day-tag" title={formatDay(dayDate(trip, d.dayIndex))}>Day {d.dayIndex + 1}</span>}
            </button>
            {d.dayIndex === null && canEdit(trip) && (
              <label className="row" style={{ fontSize: 13, fontWeight: 700, gap: 8 }}>
                Add to Day
                <select aria-label={`Add ${d.name} to day`} defaultValue="" style={{ minHeight: 40, borderRadius: 10, border: '1.5px solid var(--line-2)', padding: '0 8px' }}
                  onChange={(e) => e.target.value && schedule.mutate({ d, day: Number(e.target.value) })}>
                  <option value="" disabled>Choose…</option>
                  {Array.from({ length: trip.dayCount }, (_, i) => <option key={i} value={i}>Day {i + 1}</option>)}
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>
      {adding && <AddDestinationDialog trip={trip} day={null} onClose={() => setAdding(false)} />}
      {editing && <EditDestinationDialog trip={trip} dest={editing} onClose={() => setEditing(null)} onMoreLikeThis={() => {
        setDiscover({ dayIndex: null, like: { id: editing.id, name: editing.name }, context: `More like ${editing.name}` })
        setEditing(null)
      }} />}
      {discover && <DiscoverSheet trip={trip} ask={discover} onClose={() => setDiscover(null)} />}
    </main>
  )
}

export function TripPage({ tab }: { tab: Tab }) {
  const { tripId } = useParams()
  const [askOpen, setAskOpen] = useState(false)
  useTripLive(tripId)
  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => api<Trip>(`/api/trips/${tripId}`) })
  const destinations = useQuery({ queryKey: ['destinations', tripId], queryFn: () => api<Destination[]>(`/api/trips/${tripId}/destinations`) })
  const proposals = useProposalCounts(tripId)

  if (trip.error || destinations.error) {
    return (
      <main className="page">
        <div role="alert" className="error">{(trip.error ?? destinations.error)!.message}</div>
        <p><Link to="/trips">Back to My Trips</Link></p>
      </main>
    )
  }
  if (!trip.data || !destinations.data) return null
  return (
    <>
      <TripHeader trip={trip.data} tab={tab} openProposals={proposals.data?.OPEN ?? 0} />
      {tab === 'main' && <Itinerary trip={trip.data} destinations={destinations.data} />}
      {tab === 'destinations' && <DestinationsTab trip={trip.data} destinations={destinations.data} />}
      {tab === 'suggestions' && <SuggestionsTab trip={trip.data} destinations={destinations.data} />}
      {tab === 'members' && <MembersTab trip={trip.data} />}
      {tab === 'activity' && <ActivityTab trip={trip.data} />}
      {askOpen
        ? <AssistantDrawer trip={trip.data} onClose={() => setAskOpen(false)} />
        : <AskAiButton onClick={() => setAskOpen(true)} />}
    </>
  )
}
