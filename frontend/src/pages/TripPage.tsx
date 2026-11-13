import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api'
import { AddDestinationDialog, EditDestinationDialog, InviteDialog } from '../dialogs'
import { LinkIcon, LockIcon, Logo, PlusIcon } from '../icons'
import { useTripLive } from '../live'
import { AskAiButton, AssistantDrawer } from '../assistant'
import { PaceSwitch, useOptimize } from '../optimize'
import { SparkleIcon } from '../icons'
import { bestTime, byDay, canEdit, cityForDay, dayColor, dayDate, formatDay, formatDuration, formatRange, toInput } from '../trip'
import type { Destination, Mode, Proposal, Trip } from '../types'
import { SuggestionsTab } from './Suggestions'
import { ActivityTab, MembersTab } from './CollabTabs'

type Tab = 'main' | 'destinations' | 'suggestions' | 'members' | 'activity'
const TABS: [Tab, string, string][] = [['main', 'Main Trip', ''], ['destinations', 'Destinations', '/destinations'],
  ['suggestions', 'Suggestions', '/suggestions'], ['members', 'Members', '/members'], ['activity', 'Activity', '/activity']]

const TripMap = lazy(() => import('../map/TripMap').then((m) => ({ default: m.TripMap })))
const AVATAR_BG = ['#FFD9A8', '#BFE6E1', '#D9D4FB', '#FDE7DF']

function TripHeader({ trip, tab, openProposals }: { trip: Trip; tab: Tab; openProposals: number }) {
  const shown = trip.members.slice(0, 3)
  const [inviting, setInviting] = useState(false)
  return (
    <header className="topbar">
      <div className="topbar-inner" style={{ paddingBottom: 0, flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="spread">
          <div className="row" style={{ gap: 14 }}>
            <Link to="/" aria-label="My Trips"><Logo /></Link>
            <div>
              <nav aria-label="Breadcrumb" style={{ fontSize: 13 }} className="muted">
                <Link to="/" style={{ textDecoration: 'none' }}>My Trips</Link> <span aria-hidden="true">›</span> {trip.name}
              </nav>
              <h1 style={{ marginTop: 2, fontSize: 24, fontWeight: 800 }}>{trip.name}</h1>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="pill">{formatRange(trip.startDate, trip.endDate)}</span>
              {trip.cities.map((c) => <span key={c.id} className="pill">{c.name}{c.locked && <LockIcon />}</span>)}
            </div>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <div style={{ display: 'flex' }} aria-label={`${trip.members.length} members`}>
              {shown.map((m, i) => (
                <span key={m.userId} className="avatar" title={m.displayName} style={{ background: AVATAR_BG[i], marginLeft: i ? -8 : 0 }}>
                  {m.displayName.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {trip.members.length > 3 && <span className="avatar" style={{ background: 'var(--soft)', marginLeft: -8 }}>+{trip.members.length - 3}</span>}
            </div>
            {canEdit(trip) && <button className="btn" onClick={() => setInviting(true)}><LinkIcon /> Invite</button>}
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

function useReorder(trip: Trip) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ day, ids }: { day: number; ids: string[] }) =>
      api(`/api/trips/${trip.id}/days/${day}/order`, { method: 'PUT', body: { ids } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['destinations', trip.id] }),
  })
}

function DayCard({ trip, index, stops, active, selectedId, onSelect, onAdd, onEdit, onOptimize }: {
  trip: Trip; index: number; stops: Destination[]; active: boolean; selectedId: string | null
  onSelect: (id: string) => void; onAdd: () => void; onEdit: (d: Destination) => void; onOptimize: () => void
}) {
  const date = dayDate(trip, index)
  const color = dayColor(index)
  const reorder = useReorder(trip)
  const editable = canEdit(trip)

  function move(i: number, by: number) {
    const ids = stops.map((s) => s.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    reorder.mutate({ day: index, ids })
  }

  return (
    <article className="card day-card" data-day={index} data-active={active} aria-labelledby={`day-${index}`}>
      <div className="spread">
        <div className="row">
          <span className="dot" style={{ width: 12, height: 12, background: color }} aria-hidden="true" />
          <h2 id={`day-${index}`} style={{ fontSize: 18, fontWeight: 800 }}>Day {index + 1}</h2>
          <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>{formatDay(date)} · {cityForDay(trip.cities, date)?.name}</span>
        </div>
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{stops.length} {stops.length === 1 ? 'stop' : 'stops'}</span>
      </div>
      {stops.length === 0 && <p className="muted" style={{ margin: '14px 0 0', fontSize: 14 }}>Nothing planned yet.</p>}
      <ol style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stops.map((s, i) => (
          <li key={s.id} className="stop" data-selected={s.id === selectedId} data-stop={s.id}>
            <span className="num" style={{ background: color }}>{i + 1}</span>
            <span style={{ width: 52, flex: 'none', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.startTime?.slice(0, 5) ?? '—'}</span>
            <button className="stop-main" onClick={() => onSelect(s.id)} onDoubleClick={() => onEdit(s)}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{s.name}</span>
              <span className="muted" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>
                {[s.address?.split(',')[0], s.durationMin && `about ${formatDuration(s.durationMin)}`, bestTime(s)].filter(Boolean).join(' · ')}
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
      {editable && (
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn btn-soft" onClick={onAdd}>+ Add</button>
          {stops.length > 1 && <button className="btn btn-soft" onClick={onOptimize}>Optimize Day</button>}
        </div>
      )}
    </article>
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
  const list = useRef<HTMLElement>(null)

  // As day sections scroll past, the map follows the one at the top of the viewport.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top) setActiveDay(Number((top.target as HTMLElement).dataset.day))
    }, { rootMargin: '-10% 0px -60% 0px' })
    list.current?.querySelectorAll('[data-day]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [days.length])

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
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>Search or type each place. Add it to a day now, or save it as an idea for later.</p>
          </div>
        )}
        {days.map((stops, i) => (
          <DayCard key={i} trip={trip} index={i} stops={stops} active={activeDay === i} selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setActiveDay(i) }} onAdd={() => setAdding(i)} onEdit={setEditing}
            onOptimize={() => optimize.mutate({ mode, scope: 'DAY', dayIndex: i })} />
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

      <section aria-label="Map" className="card map-panel">
        <div className="row" style={{ gap: 8 }} role="group" aria-label="Show day on map">
          {days.map((_, i) => (
            <button key={i} className="day-chip" aria-pressed={activeDay === i} onClick={() => setActiveDay(i)}>
              <span className="dot" style={{ background: dayColor(i) }} aria-hidden="true" />Day {i + 1}
            </button>
          ))}
          <button className="day-chip" aria-pressed={activeDay === null} onClick={() => setActiveDay(null)}>All days</button>
        </div>
        <div className="map-box">
          <Suspense fallback={null}>
            <TripMap days={days.map((stops, i) => ({ color: dayColor(i), stops }))} activeDay={activeDay} selectedId={selectedId}
              onSelect={selectFromMap} center={firstCity ? [firstCity.lng!, firstCity.lat!] : undefined} />
          </Suspense>
          <div className="map-note">
            <svg width="34" height="8" viewBox="0 0 34 8" aria-hidden="true"><path d="M2 4 L32 4" stroke="#14A098" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" /></svg>
            <span>Dotted lines show visit order, not walking routes or travel times.</span>
          </div>
        </div>
      </section>

      {adding !== undefined && <AddDestinationDialog trip={trip} day={adding} onClose={() => setAdding(undefined)} />}
      {editing && <EditDestinationDialog trip={trip} dest={editing} onClose={() => setEditing(null)} />}
    </main>
  )
}

type Filter = 'all' | 'scheduled' | 'unscheduled'

function DestinationsTab({ trip, destinations }: { trip: Trip; destinations: Destination[] }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Destination | null>(null)
  const schedule = useMutation({
    mutationFn: ({ d, day }: { d: Destination; day: number }) =>
      api(`/api/trips/${trip.id}/destinations/${d.id}`, { method: 'PUT', body: toInput(d, { dayIndex: day }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['destinations', trip.id] }),
  })
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
        {canEdit(trip) && <button className="btn" onClick={() => setAdding(true)}><PlusIcon /> Add Destination</button>}
      </div>
      {schedule.error && <div role="alert" className="error" style={{ marginTop: 16 }}>{schedule.error.message}</div>}
      <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.length === 0 && <li className="muted">No places here yet.</li>}
        {shown.map((d) => (
          <li key={d.id} className="card spread" style={{ padding: '12px 16px', borderRadius: 16 }}>
            <button className="stop-main" onClick={() => setEditing(d)}>
              <span style={{ display: 'block', fontWeight: 700 }}>{d.name}</span>
              <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                {[d.dayIndex === null ? 'Unscheduled' : `Day ${d.dayIndex + 1} · ${formatDay(dayDate(trip, d.dayIndex))}${d.startTime ? ` · ${d.startTime.slice(0, 5)}` : ''}`,
                  bestTime(d)].filter(Boolean).join(' · ')}
              </span>
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
      {editing && <EditDestinationDialog trip={trip} dest={editing} onClose={() => setEditing(null)} />}
    </main>
  )
}

export function TripPage({ tab }: { tab: Tab }) {
  const { tripId } = useParams()
  const [askOpen, setAskOpen] = useState(false)
  useTripLive(tripId)
  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => api<Trip>(`/api/trips/${tripId}`) })
  const destinations = useQuery({ queryKey: ['destinations', tripId], queryFn: () => api<Destination[]>(`/api/trips/${tripId}/destinations`) })
  const proposals = useQuery({ queryKey: ['proposals', tripId], queryFn: () => api<Proposal[]>(`/api/trips/${tripId}/proposals`) })

  if (trip.error || destinations.error) {
    return (
      <main className="page">
        <div role="alert" className="error">{(trip.error ?? destinations.error)!.message}</div>
        <p><Link to="/">Back to My Trips</Link></p>
      </main>
    )
  }
  if (!trip.data || !destinations.data) return null
  return (
    <>
      <TripHeader trip={trip.data} tab={tab} openProposals={proposals.data?.filter((p) => p.status === 'OPEN').length ?? 0} />
      {tab === 'main' && <Itinerary trip={trip.data} destinations={destinations.data} />}
      {tab === 'destinations' && <DestinationsTab trip={trip.data} destinations={destinations.data} />}
      {tab === 'suggestions' && <SuggestionsTab trip={trip.data} destinations={destinations.data} proposals={proposals.data ?? []} />}
      {tab === 'members' && <MembersTab trip={trip.data} />}
      {tab === 'activity' && <ActivityTab trip={trip.data} />}
      {askOpen ? <AssistantDrawer trip={trip.data} onClose={() => setAskOpen(false)} /> : <AskAiButton onClick={() => setAskOpen(true)} />}
    </>
  )
}
