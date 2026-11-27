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

const tapAdd = async () => userEvent.click(await screen.findByRole('button', { name: /^Add \d+ places?$/ }))

function setup(stream: () => Response, role: 'OWNER' | 'VIEWER' = 'OWNER', extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /api/trips/t1': () => json(200, trip({ role })),
    'GET /api/trips/t1/destinations': () => json(200, []),
    'POST /api/trips/t1/assistant': stream,
    // "Tiny bar" only matches a same-named bar in Paris: too far from the trip, so it's added by name instead.
    'GET /api/places/search': (_, url) => json(200, url.includes('Tsukiji')
      ? [{ name: 'Tsukiji Outer Market', address: 'Chuo, Tokyo', lat: 35.66, lng: 139.77, providerId: 'osm:N1' }]
      : url.includes('Tiny') ? [{ name: 'Tiny Bar', address: 'Paris', lat: 48.86, lng: 2.35, providerId: 'osm:N2' }] : []),
    'POST /api/trips/t1/destinations': (b) => ((b as { name: string }).name === 'Dup'
      ? json(409, { detail: 'dup' }) : json(201, { id: `d-${(b as { name: string }).name}`, version: 0, ...(b as object) })),
    'DELETE /api/trips/t1/destinations/d-Tsukiji Outer Market': () => new Response(null, { status: 204 }),
    'DELETE /api/trips/t1/destinations/d-Tiny bar': () => new Response(null, { status: 204 }),
    'DELETE /api/trips/t1/destinations/d-Ben Thanh Market': () => new Response(null, { status: 204 }),
    'POST /api/trips/t1/optimize': () => json(202, { id: 'p9', status: 'PENDING' }),
    ...extra,
  })
}

it('adds the places it picks when the traveler taps Add, with Undo', async () => {
  const calls = setup(() => sse(['status', { text: 'Finding markets in Ho Chi Minh City…' }],
    ['proposal', { type: 'places', places: [
      // From the assistant's own map search: added at that location, no second lookup.
      { name: 'Ben Thanh Market', day_number: 1, lat: 10.772, lng: 106.698, providerId: 'g:b', address: 'District 1' },
      { name: 'Tsukiji', day_number: 2 }, { name: 'Tiny bar', day_number: 0 }, { name: 'Dup', day_number: 0 }] }],
    ['text', { text: 'Added 3 places. Optimize Trip will order the days.' }], ['done', {}]))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'Plan my days{Enter}')
  expect(await screen.findByText('Added 3 places. Optimize Trip will order the days.')).toBeInTheDocument()
  const sent = calls.find((c) => c.url.endsWith('/assistant'))!.body as { messages: { role: string; content: string }[] }
  expect(sent.messages).toEqual([{ role: 'user', content: 'Plan my days' }])

  // Nothing saves until the traveler taps Add.
  expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/destinations'))).toBe(false)
  expect(screen.getByText('2 on days, the rest as ideas')).toBeInTheDocument()
  await tapAdd()
  expect(await screen.findByText(/Added 3 to Destinations · 2 on days · 1 not on the map yet · 1 already in the trip/)).toBeInTheDocument()
  const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/destinations')).map((c) => c.body)
  expect(posts[0]).toMatchObject({ name: 'Ben Thanh Market', lat: 10.772, dayIndex: 0, providerId: 'g:b' })
  expect(posts[1]).toMatchObject({ name: 'Tsukiji Outer Market', lat: 35.66, dayIndex: 1, providerId: 'osm:N1' })
  expect(posts[2]).toMatchObject({ name: 'Tiny bar', lat: null, dayIndex: null }) // its only match is in Paris
  expect(calls.filter((c) => c.url.includes('/places/search')).map((c) => c.url)).not.toContainEqual(expect.stringContaining('Ben'))
  expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/trips/t1/destinations')

  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop()!.split('?')[0])).toEqual(
    ['d-Ben Thanh Market', 'd-Tsukiji Outer Market', 'd-Tiny bar']))
  expect(await screen.findByText('Removed.')).toBeInTheDocument()
})

it('keeps added places and their Undo when the drawer is closed and reopened', async () => {
  const calls = setup(() => sse(['proposal', { type: 'places', places: [{ name: 'Tsukiji', day_number: 1 }] }], ['done', {}]))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'Plan my days{Enter}')
  await tapAdd()
  await userEvent.click(screen.getByRole('button', { name: 'Close assistant' }))
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByText('Removed.')).toBeInTheDocument()
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
})

it('keeps places whose delete failed so Undo can be retried', async () => {
  let tries = 0
  const calls = setup(() => sse(['proposal', { type: 'places', places: [{ name: 'Tsukiji', day_number: 1 }, { name: 'Tiny bar', day_number: 0 }] }], ['done', {}]),
    'OWNER', { 'DELETE /api/trips/t1/destinations/d-Tiny bar': () => (tries++ ? new Response(null, { status: 204 }) : json(500, { detail: 'boom' })) })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'Plan my days{Enter}')
  await tapAdd()
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByText(/Couldn't remove 1\. Try Undo again\./)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(await screen.findByText('Removed.')).toBeInTheDocument()
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop()!.split('?')[0])).toEqual(
    ['d-Tsukiji Outer Market', 'd-Tiny bar', 'd-Tiny bar'])
})

it('keeps a place someone edited since instead of undoing over it', async () => {
  const calls = setup(() => sse(['proposal', { type: 'places', places: [{ name: 'Tsukiji', day_number: 1 }, { name: 'Tiny bar', day_number: 0 }] }], ['done', {}]),
    'OWNER', { 'DELETE /api/trips/t1/destinations/d-Tiny bar': () => json(409, { detail: 'It changed since' }) })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'Plan my days{Enter}')
  await tapAdd()
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByText('Kept 1 edited since')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toContain('/api/trips/t1/destinations/d-Tiny bar?version=0')
})

it('looks a place up only in the city the assistant named', async () => {
  const calls = setup(() => sse(['proposal', { type: 'places', places: [
    { name: 'Tsukiji', day_number: 1, city: 'Tokyo' }, { name: 'Ichiran', day_number: 0, city: 'Osaka' }] }], ['done', {}]))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'Plan my days{Enter}')
  await tapAdd()
  expect(await screen.findByText(/Added 2 to Destinations/)).toBeInTheDocument()
  // Osaka isn't a trip city, so Ichiran isn't searched near Tokyo; it's added by name for the traveler to place.
  expect(calls.filter((c) => c.url.includes('/places/search')).map((c) => c.url)).toEqual([expect.stringContaining('Tsukiji')])
})

it('tells failed saves apart from duplicates, and keeps a named city to its own radius', async () => {
  setup(() => sse(['proposal', { type: 'places', places: [
    { name: 'Dup', day_number: 0 }, { name: 'Broken', day_number: 0 }, { name: 'Far Temple', day_number: 0, city: 'Tokyo' }] }], ['done', {}]),
  'OWNER', {
    'POST /api/trips/t1/destinations': (b) => {
      const name = (b as { name: string }).name
      if (name === 'Dup') return json(409, { detail: 'dup' })
      if (name === 'Broken') return json(500, { detail: 'boom' })
      return json(201, { id: `d-${name}`, version: 0, ...(b as object) })
    },
    // About 100 km from Tokyo: near enough for the trip, too far for a place the assistant said is in Tokyo.
    'GET /api/places/search': (_, url) => json(200, url.includes('Far')
      ? [{ name: 'Far Temple', address: 'Gunma', lat: 36.39, lng: 139.06, providerId: 'osm:F' }] : []),
  })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'Add these{Enter}')
  await tapAdd()
  expect(await screen.findByText(/Added 1 to Destinations · 1 not on the map yet · 1 already in the trip · 1 couldn't be saved/)).toBeInTheDocument()
})

it('says so when the reply is cut off before it finishes', async () => {
  setup(() => sse(['status', { text: 'Finding food in Tokyo…' }]))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'food{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('The reply was cut off. Try again.')
})

it('keeps a draft typed while the assistant is still replying', async () => {
  // A reply still streaming: the assistant is busy.
  setup(() => new Response(new ReadableStream({
    start: (c) => c.enqueue(new TextEncoder().encode('event: status\ndata: {"text":"Thinking…"}\n\n')),
  }), { status: 200 }))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  const box = screen.getByLabelText('Message the assistant')
  await userEvent.type(box, 'first{Enter}')
  expect(await screen.findByText('Thinking…')).toBeInTheDocument()
  await userEvent.type(box, 'next question{Enter}')
  expect(box).toHaveValue('next question')
})

it('moves focus into the drawer, closes on Escape, and hands focus back to Ask AI', async () => {
  setup(() => sse(['done', {}]))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  expect(screen.getByLabelText('Message the assistant')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'AI assistant' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveFocus()
})

it('shows what it is doing while it searches', async () => {
  // A stream still open mid-search: the status shows in the reply bubble until the answer arrives.
  setup(() => new Response(new ReadableStream({
    start: (c) => c.enqueue(new TextEncoder().encode('event: status\ndata: {"text":"Finding food in Hue…"}\n\n')),
  }), { status: 200 }))
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  await userEvent.type(screen.getByLabelText('Message the assistant'), 'food in Hue{Enter}')
  expect(await screen.findByText('Finding food in Hue…')).toBeInTheDocument()
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
  expect(screen.queryByRole('dialog', { name: 'AI assistant' })).not.toBeInTheDocument()
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
