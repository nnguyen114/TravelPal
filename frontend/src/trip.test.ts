import { describe, expect, it } from 'vitest'
import { byDay, cityForDay, dayColor, dayDate, formatDay, formatDuration, formatRange, toInput } from './trip'
import type { City, Destination, Trip } from './types'

const city = (name: string, startDate: string | null = null, endDate: string | null = null): City =>
  ({ id: name, name, lat: null, lng: null, startDate, endDate, locked: false })
const dest = (id: string, dayIndex: number | null, position: number | null): Destination => ({
  id, name: id, address: null, lat: null, lng: null, providerId: null, notes: null, durationMin: 60,
  dayIndex, position, startTime: null, locked: false, flexibility: 'FLEXIBLE',
})

describe('trip helpers', () => {
  it('computes and formats dates', () => {
    expect(dayDate({ startDate: '2027-06-30' }, 1)).toBe('2027-07-01')
    expect(formatDay('2027-06-10')).toBe('Thu, Jun 10')
    expect(formatRange('2027-06-10', '2027-06-17')).toBe('Jun 10 – 17')
    expect(formatRange('2027-06-28', '2027-07-02')).toBe('Jun 28 – Jul 2')
  })

  it('finds the city allocated to a day', () => {
    const cities = [city('Tokyo'), city('Kyoto', '2027-06-14', '2027-06-16')]
    expect(cityForDay(cities, '2027-06-15')?.name).toBe('Kyoto')
    expect(cityForDay(cities, '2027-06-10')?.name).toBe('Tokyo')
    expect(cityForDay([city('Osaka', '2027-06-01', '2027-06-02')], '2027-06-10')?.name).toBe('Osaka')
  })

  it('formats durations', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 hr')
    expect(formatDuration(90)).toBe('1 hr 30 min')
  })

  it('groups destinations into ordered days and ignores out-of-range ones', () => {
    const trip = { dayCount: 2 } as Trip
    const days = byDay(trip, [dest('b', 0, 1), dest('a', 0, 0), dest('idea', null, null), dest('c', 1, 0), dest('x', 5, 0)])
    expect(days.map((d) => d.map((x) => x.id))).toEqual([['a', 'b'], ['c']])
    expect(dayColor(7)).toBe(dayColor(0))
    expect(toInput(dest('a', 0, 0), { locked: true })).not.toHaveProperty('id')
  })
})
