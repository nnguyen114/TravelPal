import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { dest, json, mockApi, renderAt, trip } from '../test-utils'
import type { Preview } from '../types'
import { OptimizePage } from './OptimizePage'
import { TripPage } from './TripPage'

vi.mock('../map/TripMap', () => ({ TripMap: () => null }))
afterEach(() => vi.unstubAllGlobals())

const routes = (
  <>
    <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
    <Route path="/trips/:tripId/optimize/:previewId" element={<OptimizePage />} />
  </>
)
const dests = [dest('a', 0, 0, { name: 'Meiji Jingu' }), dest('b', null, null, { name: 'Senso-ji' }),
  dest('c', 1, 0, { name: 'Dinner', locked: true }), dest('d', null, null, { name: 'Golden Gai' }), dest('e', null, null, { name: 'Teamlab' })]
const ready = (over: Partial<Preview> = {}): Preview => ({
  id: 'p1', status: 'READY', stale: false, createdAt: new Date().toISOString(), error: null,
  request: { mode: 'BALANCED', scope: 'TRIP', dayIndex: null, instructions: 'slow mornings' },
  result: {
    items: [
      { id: 'a', dayIndex: 1, position: 0, startTime: '09:00' }, { id: 'c', dayIndex: 1, position: 1, startTime: '19:00' },
      { id: 'b', dayIndex: 0, position: 0, startTime: '10:00' }, { id: 'd', dayIndex: null, position: null, startTime: null },
      { id: 'e', dayIndex: null, position: null, startTime: null },
    ],
    moved: ['a'], added: ['b'], unscheduled: ['d'], keptLocked: ['c'], needsReview: [{ id: 'e', reason: 'Hours unknown' }],
    scheduled: 3, total: 5, explanation: 'Grouped by neighborhood.',
    notes: [{ kind: 'verified', text: 'Dinner kept.' }, { kind: 'unsure', text: 'Check Teamlab hours.' }],
  },
  ...over,
})

function base(preview: () => Response, extra = {}) {
  return mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, dests),
    'GET /api/trips/t1/previews/p1': preview,
    'POST /api/trips/t1/optimize': () => json(202, { ...ready(), id: 'p2', status: 'PENDING', result: null }),
    'GET /api/trips/t1/previews/p2': () => json(200, { ...ready(), id: 'p2', status: 'PENDING', result: null }),
    ...extra,
  })
}

it('shows the plan with tags, notes and leftovers, then applies', async () => {
  const calls = base(() => json(200, ready()), { 'POST /api/trips/t1/previews/p1/apply': () => new Response(null, { status: 204 }) })
  renderAt('/trips/t1/optimize/p1', routes)
  expect(await screen.findByText('3 of 5 destinations scheduled')).toBeInTheDocument()
  expect(screen.getByText('1 could not fit. They stay in Unscheduled.')).toBeInTheDocument()
  expect(screen.getByText('VERIFIED')).toBeInTheDocument()
  expect(screen.getByText('Check Teamlab hours.')).toBeInTheDocument()
  const day2 = screen.getByRole('article', { name: 'Day 2 preview' })
  expect(within(day2).getByText('Meiji Jingu').closest('li')).toHaveTextContent('Moved')
  expect(within(day2).getByText('Dinner').closest('li')).toHaveTextContent('Locked')
  expect(within(screen.getByRole('article', { name: 'Day 1 preview' })).getByText('Senso-ji').closest('li')).toHaveTextContent('Added')
  expect(within(screen.getByRole('article', { name: 'Day 3 preview' })).getByText('Free day')).toBeInTheDocument()
  expect(screen.getByText('Golden Gai')).toBeInTheDocument()
  expect(screen.getByText('Needs Review · Teamlab: Hours unknown')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
  expect(await screen.findByRole('article', { name: 'Day 1' })).toBeInTheDocument()
  expect(calls.some((c) => c.url.endsWith('/apply'))).toBe(true)
})

it('re-runs with another pace or modified instructions', async () => {
  const calls = base(() => json(200, ready()))
  renderAt('/trips/t1/optimize/p1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Packed' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/optimize'))?.body)
    .toEqual({ mode: 'PACKED', scope: 'TRIP', dayIndex: null, instructions: 'slow mornings' }))
  expect(await screen.findByText('Building your plan…')).toBeInTheDocument()
})

it('modify sends new instructions; discard goes back', async () => {
  const calls = base(() => json(200, ready({ request: { mode: 'RELAXED', scope: 'DAY', dayIndex: 1, instructions: null } })),
    { 'POST /api/trips/t1/previews/p1/discard': () => new Response(null, { status: 204 }) })
  renderAt('/trips/t1/optimize/p1', routes)
  expect(await screen.findByRole('article', { name: 'Day 2 preview' })).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'Day 1 preview' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Modify' }))
  await userEvent.type(screen.getByLabelText('What should change?'), 'start at 10')
  await userEvent.click(screen.getByRole('button', { name: 'Run again' }))
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/optimize'))?.body).toEqual({ mode: 'RELAXED', scope: 'DAY', dayIndex: 1, instructions: 'start at 10' }))
})

it('discard returns to the trip', async () => {
  base(() => json(200, ready()), { 'POST /api/trips/t1/previews/p1/discard': () => new Response(null, { status: 204 }) })
  renderAt('/trips/t1/optimize/p1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(await screen.findByRole('article', { name: 'Day 1' })).toBeInTheDocument()
})

it('stale, failed, pending-too-long and settled previews', async () => {
  const r1 = base(() => json(200, ready({ stale: true })))
  const v = renderAt('/trips/t1/optimize/p1', routes)
  expect(await screen.findByText(/trip changed after this preview/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }))
  await waitFor(() => expect(r1.some((c) => c.url.endsWith('/optimize'))).toBe(true))
  v.unmount()

  base(() => json(200, ready({ status: 'FAILED', result: null, error: 'The optimizer couldn’t build a plan.' })))
  const f = renderAt('/trips/t1/optimize/p1', routes)
  expect(await screen.findByText('The optimizer couldn’t build a plan.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  f.unmount()

  base(() => json(200, ready({ status: 'PENDING', result: null, createdAt: new Date(Date.now() - 120_000).toISOString() })))
  const p = renderAt('/trips/t1/optimize/p1', routes)
  expect(await screen.findByText(/taking longer than usual/)).toBeInTheDocument()
  p.unmount()

  base(() => json(200, ready({ status: 'APPLIED' })))
  renderAt('/trips/t1/optimize/p1', routes)
  expect(await screen.findByText(/This preview was applied/)).toBeInTheDocument()
})

it('apply conflicts are shown; viewers get no actions', async () => {
  base(() => json(200, ready()), { 'POST /api/trips/t1/previews/p1/apply': () => json(409, { detail: 'The trip changed since this preview was made.' }) })
  const a = renderAt('/trips/t1/optimize/p1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Apply Changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The trip changed')
  a.unmount()
  mockApi({
    'GET /api/trips/t1': () => json(200, trip({ role: 'VIEWER' })), 'GET /api/trips/t1/destinations': () => json(200, dests),
    'GET /api/trips/t1/previews/p1': () => json(200, ready()),
  })
  renderAt('/trips/t1/optimize/p1', routes)
  await screen.findByText('3 of 5 destinations scheduled')
  expect(screen.queryByRole('button', { name: 'Apply Changes' })).not.toBeInTheDocument()
})

it('workspace starts trip and day optimization at the chosen pace', async () => {
  const calls = base(() => json(200, ready()), {
    'GET /api/trips/t1/destinations': () => json(200, [dest('a', 0, 0), dest('b', 0, 1)]),
  })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Relaxed' }))
  await userEvent.click(screen.getByRole('button', { name: /Optimize Trip/ }))
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/optimize'))?.body).toEqual({ mode: 'RELAXED', scope: 'TRIP' }))
  expect(await screen.findByText('Building your plan…')).toBeInTheDocument()
})

it('optimize day sends the day', async () => {
  const calls = base(() => json(200, ready()), { 'GET /api/trips/t1/destinations': () => json(200, [dest('a', 0, 0), dest('b', 0, 1)]) })
  renderAt('/trips/t1', routes)
  await userEvent.click(within(await screen.findByRole('article', { name: 'Day 1' })).getByRole('button', { name: 'Optimize Day' }))
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/optimize'))?.body).toEqual({ mode: 'BALANCED', scope: 'DAY', dayIndex: 0 }))
})
