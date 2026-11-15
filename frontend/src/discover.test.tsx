import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { freeTime } from './trip'
import { dest, json, mockApi, renderAt, trip } from './test-utils'
import { TripPage } from './pages/TripPage'

vi.mock('./map/TripMap', () => ({ TripMap: () => null }))
afterEach(() => vi.unstubAllGlobals())

const routes = (
  <>
    <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
    <Route path="/trips/:tripId/destinations" element={<TripPage tab="destinations" />} />
    <Route path="/trips/:tripId/suggestions" element={<h1>Proposals page</h1>} />
  </>
)
const S = (name: string, i: number) => ({ name, address: 'Jingumae, Tokyo', lat: 35.67, lng: 139.70, providerId: `osm:N${i}`, category: 'cafe',
  why: `${name} is close to your saved cafes.`, distanceKm: 0.4 })
const RESULT = { vibe: 'independent, design-led coffee', note: 'Opening hours and reviews aren’t verified.', suggestions: [S('Koffee Mameya', 1), S('Cafe Kitsune', 2), S('Bakery Bar', 3)] }
const stops = [dest('Meiji', 0, 0, { startTime: '09:00:00', durationMin: 90 }), dest('Cat Street', 0, 1, { startTime: '10:45:00', durationMin: 120 }),
  dest('Dinner', 0, 2, { startTime: '19:00:00', locked: true })]

function setup(extra = {}) {
  return mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, stops),
    'GET /api/trips/t1/proposals': () => json(200, []),
    'POST /api/trips/t1/discover': () => json(200, RESULT),
    'POST /api/trips/t1/destinations': (b) => json(201, b),
    'POST /api/trips/t1/proposals': () => json(201, { id: 'p1' }),
    'POST /api/trips/t1/discover/not-interested': () => new Response(null, { status: 204 }),
    ...extra,
  })
}

describe('freeTime', () => {
  it('finds the longest gap of 90+ minutes inside the day', () => {
    expect(freeTime(stops)).toEqual({ from: '12:45', to: '19:00' })
    expect(freeTime([dest('a', 0, 0, { startTime: '09:00:00', durationMin: 570 })])).toBeNull()
    expect(freeTime([dest('a', 0, 0, { startTime: null })])).toEqual({ from: '09:00', to: '19:00' })
  })
})

it('free time on a day opens Find More Places; picks can be added, saved, proposed or skipped', async () => {
  const calls = setup()
  renderAt('/trips/t1', routes)
  const day1 = await screen.findByRole('article', { name: 'Day 1' })
  expect(within(day1).getByText(/12:45 – 19:00, nothing planned/)).toBeInTheDocument()
  await userEvent.click(within(day1).getByRole('button', { name: 'Find More Places' }))
  const sheet = screen.getByRole('dialog')
  expect(within(sheet).getByText('Near Day 1 · free 12:45 – 19:00')).toBeInTheDocument()
  await userEvent.type(within(sheet).getByLabelText('What are you looking for?'), 'chic cafes{Enter}')
  expect(await within(sheet).findByText('You asked for: independent, design-led coffee')).toBeInTheDocument()
  expect(calls.find((c) => c.url.endsWith('/discover'))?.body).toEqual({ query: 'chic cafes', dayIndex: 0, likeDestinationId: null })

  const mameya = within(sheet).getByRole('article', { name: 'Koffee Mameya' })
  expect(within(mameya).getByText(/close to your saved cafes/)).toBeInTheDocument()
  await userEvent.click(within(mameya).getByRole('button', { name: 'Add' }))
  expect(await within(mameya).findByText('Added to Day 1')).toBeInTheDocument()
  expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/destinations'))?.body).toMatchObject({ name: 'Koffee Mameya', dayIndex: 0, providerId: 'osm:N1' })

  await userEvent.click(within(within(sheet).getByRole('article', { name: 'Cafe Kitsune' })).getByRole('button', { name: 'Save' }))
  expect(await within(sheet).findByText('Saved as an idea')).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: 'Not interested in Bakery Bar' }))
  await waitFor(() => expect(within(sheet).queryByRole('article', { name: 'Bakery Bar' })).not.toBeInTheDocument())
  expect(calls.find((c) => c.url.endsWith('/not-interested'))?.body).toEqual({ providerId: 'osm:N3', name: 'Bakery Bar' })

  await userEvent.click(within(sheet).getByRole('button', { name: 'More like these' }))
  await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/discover')).at(-1)?.body)
    .toMatchObject({ query: 'chic cafes, more like Koffee Mameya, Cafe Kitsune' }))
})

it('proposing a pick goes through the group', async () => {
  setup()
  renderAt('/trips/t1', routes)
  await userEvent.click(within(await screen.findByRole('article', { name: 'Day 1' })).getByRole('button', { name: 'Find More Places' }))
  const sheet = screen.getByRole('dialog')
  await userEvent.type(within(sheet).getByLabelText('What are you looking for?'), 'cafes{Enter}')
  await userEvent.click(within(await within(sheet).findByRole('article', { name: 'Koffee Mameya' })).getByRole('button', { name: 'Propose' }))
  expect(await within(sheet).findByText('Proposed to the group')).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: 'See proposals' }))
  expect(await screen.findByRole('heading', { name: 'Proposals page' })).toBeInTheDocument()
})

it('More like this from a place runs straight away; errors show', async () => {
  const calls = setup({ 'POST /api/trips/t1/discover': () => json(429, { detail: "You've hit the hourly AI limit." }) })
  renderAt('/trips/t1/destinations', routes)
  await userEvent.click(await screen.findByRole('button', { name: /^Cat Street/ }))
  await userEvent.click(screen.getByRole('button', { name: 'More like this' }))
  expect(await screen.findByText('More like Cat Street')).toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent('hourly AI limit')
  expect(calls.find((c) => c.url.endsWith('/discover'))?.body).toEqual({ query: null, dayIndex: null, likeDestinationId: 'Cat Street' })
})

it('trip-wide search from Destinations and an empty result', async () => {
  setup({ 'POST /api/trips/t1/discover': () => json(200, { ...RESULT, suggestions: [] }) })
  renderAt('/trips/t1/destinations', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Find More Places' }))
  expect(screen.getByText('Anywhere in Tokyo')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('What are you looking for?'), 'museums{Enter}')
  expect(await screen.findByText(/Nothing matched nearby/)).toBeInTheDocument()
})

it('paste a link to pick a place in Add Destination', async () => {
  const calls = setup({
    'POST /api/trips/t1/places/from-link': (b: unknown) => json(200, (b as { url: string }).url.includes('bad')
      ? { readable: false, guess: null, candidates: [], message: 'That page couldn’t be read (it may need a login). Type the place name instead.' }
      : { readable: true, guess: 'Koffee Mameya', message: null,
          candidates: [{ name: 'Koffee Mameya Kakeru', address: 'Kiyosumi, Tokyo', lat: 35.68, lng: 139.79, providerId: 'osm:N9' }] }),
  })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: /Add Destination/ }))
  const link = screen.getByLabelText(/Or paste a link/)
  await userEvent.type(link, 'https://www.tiktok.com/bad')
  await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
  expect(await screen.findByText(/may need a login/)).toBeInTheDocument()
  await userEvent.clear(link)
  await userEvent.type(link, 'https://www.instagram.com/p/1')
  await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
  await userEvent.click(await screen.findByRole('button', { name: /Koffee Mameya Kakeru/ }))
  expect(screen.getByText('Koffee Mameya Kakeru')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add Directly' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/destinations'))?.body)
    .toMatchObject({ name: 'Koffee Mameya Kakeru', lat: 35.68, providerId: 'osm:N9' }))
})
