import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { json, mockApi, renderAt, trip } from './test-utils'
import { TripPage } from './pages/TripPage'
import { recent } from './assistant'

vi.mock('./map/TripMap', () => ({ TripMap: () => null }))
afterEach(() => vi.unstubAllGlobals())

const routes = (
  <>
    <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
    <Route path="/trips/:tripId/optimize/:previewId" element={<h1>Preview page</h1>} />
  </>
)
function sse(...events: [string, unknown][]) {
  return new Response(events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { status: 200 })
}

function setup(stream: () => Response, role: 'OWNER' | 'VIEWER' = 'OWNER') {
  return mockApi({
    'GET /api/trips/t1': () => json(200, trip({ role })),
    'GET /api/trips/t1/destinations': () => json(200, []),
    'POST /api/trips/t1/assistant': stream,
    // "Tiny bar" only matches a same-named bar in Paris: too far from the trip, so it's added by name instead.
    'GET /api/places/search': (_, url) => json(200, url.includes('Tsukiji')
      ? [{ name: 'Tsukiji Outer Market', address: 'Chuo, Tokyo', lat: 35.66, lng: 139.77, providerId: 'osm:N1' }]
      : url.includes('Tiny') ? [{ name: 'Tiny Bar', address: 'Paris', lat: 48.86, lng: 2.35, providerId: 'osm:N2' }] : []),
    'POST /api/trips/t1/destinations': (b) => ((b as { name: string }).name === 'Dup' ? json(409, { detail: 'dup' }) : json(201, b)),
    'POST /api/trips/t1/optimize': () => json(202, { id: 'p9', status: 'PENDING' }),
  })
}

it('streams an answer and adds proposed places after confirmation', async () => {
  const calls = setup(() => sse(['text', { text: 'Here are ' }], ['text', { text: 'the places.' }],
    ['proposal', { type: 'places', places: [{ name: 'Tsukiji', day_number: 2 }, { name: 'Tiny bar', day_number: 0 }, { name: 'Dup', day_number: 0 }] }],
    ['done', {}]))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'Tsukiji, Tiny bar{Enter}')
  expect(await screen.findByText('Here are the places.')).toBeInTheDocument()
  expect(screen.getByText('Tsukiji, Tiny bar')).toBeInTheDocument()
  const sent = calls.find((c) => c.url.endsWith('/assistant'))!.body as { messages: { role: string; content: string }[] }
  expect(sent.messages).toEqual([{ role: 'user', content: 'Tsukiji, Tiny bar' }])

  await userEvent.click(screen.getByRole('button', { name: 'Add 3 places' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Added 2 of 3. 2 without a map location yet. 1 already in the trip')
  const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/destinations')).map((c) => c.body)
  expect(posts[0]).toMatchObject({ name: 'Tsukiji Outer Market', lat: 35.66, dayIndex: 1, providerId: 'osm:N1' })
  expect(posts[1]).toMatchObject({ name: 'Tiny bar', lat: null, dayIndex: null })
})

it('turns an optimize proposal into a preview run', async () => {
  const calls = setup(() => sse(['proposal', { type: 'optimize', mode: 'RELAXED', day_number: 3, instructions: 'slow morning' }], ['done', {}]))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.click(screen.getByRole('button', { name: 'Make Day 2 lighter' }))
  expect(await screen.findByText(/Relaxed plan for Day 3/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Preview plan' }))
  expect(await screen.findByRole('heading', { name: 'Preview page' })).toBeInTheDocument()
  expect(calls.find((c) => c.url.endsWith('/optimize'))?.body).toEqual({ mode: 'RELAXED', scope: 'DAY', dayIndex: 2, instructions: 'slow morning' })
})

it('shows assistant errors, keeps viewers read-only, and closes', async () => {
  setup(() => sse(['error', { message: 'The assistant is unavailable right now.' }],
    ['proposal', { type: 'optimize', mode: 'PACKED', day_number: 0, instructions: '' }], ['done', {}]), 'VIEWER')
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'hi{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  expect(screen.getByRole('button', { name: 'Only editors can optimize' })).toBeDisabled()
  expect(screen.getByText(/Packed plan for the whole trip/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Close assistant' }))
  expect(screen.queryByRole('complementary', { name: 'AI assistant' })).not.toBeInTheDocument()
})

it('surfaces HTTP failures like quota limits', async () => {
  setup(() => json(429, { detail: "You've hit the hourly AI limit. Try again later." }))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'hi{Enter}')
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('hourly AI limit'))
})

it('sends only the most recent 40 messages, starting with the traveler', () => {
  const msgs = Array.from({ length: 45 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}`, proposals: [] }))
  const sent = recent(msgs)
  expect(sent.length).toBe(39)
  expect(sent[0]).toEqual({ role: 'user', content: 'm6' })
  expect(sent.at(-1)).toEqual({ role: 'user', content: 'm44' })
  expect(recent([{ role: 'assistant', content: '', proposals: [] }])).toEqual([])
})
