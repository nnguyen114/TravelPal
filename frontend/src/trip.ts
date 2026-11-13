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

export function byDay(trip: Trip, destinations: Destination[]): Destination[][] {
  const days: Destination[][] = Array.from({ length: trip.dayCount }, () => [])
  for (const d of destinations) if (d.dayIndex !== null && d.dayIndex < trip.dayCount) days[d.dayIndex].push(d)
  return days.map((ds) => ds.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))
}

export function toInput(d: Destination, patch: Partial<DestinationInput> = {}): DestinationInput {
  const { id: _id, position: _p, ...rest } = d
  return { ...rest, ...patch }
}

export const canEdit = (trip: Trip) => trip.role !== 'VIEWER'
