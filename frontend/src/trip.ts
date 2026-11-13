import type { City, Destination, DestinationInput, Trip } from './types'

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
