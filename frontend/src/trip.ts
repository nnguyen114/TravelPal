import type { City, Destination, DestinationInput, DraftItem, Entry, EntryDetails, Trip } from './types'

export const DAY_COLORS = ['#14A098', '#F2734E', '#7C6CF0', '#D69A1E', '#3B7FC4', '#D9548A', '#5E9E3B']
export const dayColor = (i: number) => DAY_COLORS[i % DAY_COLORS.length]

const parse = (iso: string) => new Date(`${iso}T00:00:00`)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function dayDate(trip: Pick<Trip, 'startDate'>, dayIndex: number): string {
  const d = parse(trip.startDate)
  d.setDate(d.getDate() + dayIndex)
  return iso(d)
}

export const formatDay = (isoDate: string) =>
  parse(isoDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export function formatRange(start: string, end: string): string {
  const a = parse(start)
  const b = parse(end)
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${month(a)} ${a.getDate()} – ${b.getDate()}`
    : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`
}

/** The city allocated to a date, else the first city without fixed dates, else the first city. */
export function cityForDay(cities: City[], isoDate: string): City | undefined {
  return cities.find((c) => c.startDate && c.endDate && c.startDate <= isoDate && isoDate <= c.endDate)
    ?? cities.find((c) => !c.startDate) ?? cities[0]
}

/** Great-circle distance in km. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

export function formatDuration(min: number | null): string {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`
}

/** "Day trip", "Best after 20:00", "Best before 11:00" or "Best 10:00–16:00"; empty when untagged. */
export function bestTime(d: Pick<Destination, 'visitAfter' | 'visitBefore' | 'dayTrip'>): string {
  const t = (x: string | null) => x?.slice(0, 5)
  if (d.dayTrip) return 'Day trip'
  if (d.visitAfter && d.visitBefore) return `Best ${t(d.visitAfter)}–${t(d.visitBefore)}`
  if (d.visitAfter) return `Best after ${t(d.visitAfter)}`
  if (d.visitBefore) return `Best before ${t(d.visitBefore)}`
  return ''
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The longest stretch of at least 90 minutes with nothing planned, within a 09:00-19:00 day. */
export function freeTime(stops: Destination[], dayStart = 9 * 60, dayEnd = 19 * 60): { from: string; to: string } | null {
  const busy = stops.filter((s) => s.startTime).map((s) => [toMin(s.startTime!), toMin(s.startTime!) + (s.durationMin ?? 60)])
    .sort((a, b) => a[0] - b[0])
  let best: [number, number] | null = null
  let t = dayStart
  for (const [start, end] of [...busy, [dayEnd, dayEnd]]) {
    const gapEnd = Math.min(start, dayEnd)
    if (gapEnd - t >= 90 && (!best || gapEnd - t > best[1] - best[0])) best = [t, gapEnd]
    t = Math.max(t, end)
  }
  return best && { from: toHHMM(best[0]), to: toHHMM(best[1]) }
}

export function byDay(trip: Trip, destinations: Destination[]): Destination[][] {
  const days: Destination[][] = Array.from({ length: trip.dayCount }, () => [])
  for (const d of destinations) if (d.dayIndex !== null && d.dayIndex < trip.dayCount) days[d.dayIndex].push(d)
  return days.map((ds) => ds.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))
}

export function toInput(d: Destination, patch: Partial<DestinationInput> = {}): DestinationInput {
  const { id: _id, position: _p, hintsSource: _h, ...rest } = d
  return { ...rest, ...patch }
}

export const canEdit = (trip: Trip) => trip.role !== 'VIEWER'

/** "In 3 weeks", "Tomorrow", "Day 2 of 4"... how far away a trip is, from the traveler's point of view. */
export function countdown(start: string, end: string, today: Date): string {
  const day = 86_400_000
  const now = parse(iso(today)).getTime()
  const toStart = Math.round((parse(start).getTime() - now) / day)
  const length = Math.round((parse(end).getTime() - parse(start).getTime()) / day) + 1
  if (toStart > 1) {
    if (toStart < 14) return `In ${toStart} days`
    if (toStart < 60) return `In ${Math.round(toStart / 7)} weeks`
    return `In ${Math.round(toStart / 30)} months`
  }
  if (toStart === 1) return 'Tomorrow'
  if (-toStart < length) return `Day ${1 - toStart} of ${length}`
  return 'Done. Hope it was great'
}

/** The date a number of days after (or before) an ISO date. */
export function shiftDate(isoDate: string, days: number): string {
  const d = parse(isoDate)
  d.setDate(d.getDate() + days)
  return iso(d)
}

export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000)

/** "Dec 25" */
export const formatShort = (isoDate: string) => parse(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** "20:30" -> "8:30 PM" */
export function ampm(t: string): string {
  const h = Number(t.slice(0, 2))
  return `${h % 12 || 12}:${t.slice(3, 5)} ${h < 12 ? 'AM' : 'PM'}`
}

/** A day's entries: notes first, then flights, lodging and meals by time, then open choices. */
export function entriesForDay(entries: Entry[], dayIndex: number | null): Entry[] {
  const rank = (e: Entry) => (e.kind === 'NOTE' ? 0 : e.kind === 'CHOICE' ? 2 : 1)
  return entries.filter((e) => e.dayIndex === dayIndex).sort((a, b) =>
    rank(a) - rank(b) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.position - b.position)
}

/** Icon and spoken name for each kind of itinerary row. */
export const KIND: Record<DraftItem['kind'], [string, string]> = {
  PLACE: ['📍', 'Place'], FLIGHT: ['✈️', 'Flight'], LODGING: ['🛏️', 'Hotel'], MEAL: ['🍽️', 'Meal'], CHOICE: ['🤔', 'Still to decide'],
  NOTE: ['📝', 'Note'],
}
const LODGING = { CHECK_IN: 'Check-in', CHECK_OUT: 'Check-out', DROP_OFF: 'Bag drop-off' }

/** One line under an entry's title: "LAX → HND · arrives Dec 25, 3:20 PM", "Ueno or Asakusa", "Check-in · Hotel Gracery". */
export function entrySummary(kind: DraftItem['kind'], d: EntryDetails | undefined, date: string | null): string {
  if (!d) return ''
  if (kind === 'FLIGHT' && d.arrives) {
    const day = d.arrivesDay && date ? `${formatShort(shiftDate(date, d.arrivesDay))}, ` : ''
    return [d.number, `arrives ${day}${ampm(d.arrives)}`].filter(Boolean).join(' · ')
  }
  if (kind === 'LODGING') return [d.action && LODGING[d.action], d.hotel].filter(Boolean).join(' · ')
  if (kind === 'MEAL') return (d.areas ?? []).join(' or ')
  return ''
}
