import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { dest, json, mockApi, renderAt, trip } from '../test-utils'
import { TripPage } from './TripPage'

vi.mock('../map/TripMap', () => ({
  TripMap: ({ onSelect, days }: { onSelect: (id: string) => void; days: { stops: { id: string; name: string }[] }[] }) => (
    <div>{days.flatMap((d) => d.stops).map((s) => <button key={s.id} onClick={() => onSelect(s.id)}>marker {s.name}</button>)}</div>
  ),
}))
afterEach(() => vi.unstubAllGlobals())

const routes = (
  <>
    <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
    <Route path="/trips/:tripId/destinations" element={<TripPage tab="destinations" />} />
  </>
)
const stops = [
  dest('Meiji Jingu', 0, 0), dest('Cat Street', 0, 1, { locked: true, startTime: '12:00:00' }), dest('Senso-ji', 2, 0),
  dest('Golden Gai', null, null, { visitAfter: '20:00:00', hintsSource: 'AI' }),
  dest('Nikko', 2, 1, { dayTrip: true }),
]

function api(over: Partial<Parameters<typeof trip>[0]> = {}) {
  return mockApi({
    'GET /api/trips/t1': () => json(200, trip(over)),
    'GET /api/trips/t1/destinations': () => json(200, stops),
    'PUT /api/trips/t1/days/0/order': () => json(200, []),
    'POST /api/trips/t1/destinations': (b) => json(201, b),
    'PUT /api/trips/t1/destinations/Cat Street': (b) => json(200, b),
    'PUT /api/trips/t1/destinations/Golden Gai': (b) => json(200, b),
    'DELETE /api/trips/t1/destinations/Cat Street': () => new Response(null, { status: 204 }),
  })
}

it('renders the day-by-day plan with header, locks, and unscheduled count', async () => {
  api()
  renderAt('/trips/t1', routes)
  expect(await screen.findByRole('heading', { name: 'Japan 2027' })).toBeInTheDocument()
  expect(screen.getByText('Jun 10 – 12')).toBeInTheDocument()
  expect(screen.getByLabelText('4 members')).toHaveTextContent('+1')
  const day1 = screen.getByRole('article', { name: 'Day 1' })
  expect(within(day1).getByText('Thu, Jun 10 · Tokyo')).toBeInTheDocument()
  expect(within(day1).getByText('2 stops')).toBeInTheDocument()
  expect(within(day1).getByText('Locked')).toBeInTheDocument()
  expect(within(day1).getAllByText('Harajuku · about 1 hr 30 min')).toHaveLength(2)
  expect(within(screen.getByRole('article', { name: 'Day 2' })).getByText('Nothing planned yet.')).toBeInTheDocument()
  expect(screen.getByText('1 unscheduled place')).toBeInTheDocument()
  expect(within(screen.getByRole('article', { name: 'Day 3' })).getByText(/Day trip$/)).toBeInTheDocument()
})

it('edits best time and day trip, showing when AI suggested them', async () => {
  const calls = api()
  renderAt('/trips/t1/destinations', routes)
  await userEvent.click(await screen.findByRole('button', { name: /Golden Gai/ }))
  expect(screen.getByText(/suggested by AI/)).toBeInTheDocument()
  expect(screen.getByLabelText('Not before')).toHaveValue('20:00')
  await userEvent.type(screen.getByLabelText('Done by'), '23:30')
  await userEvent.click(screen.getByLabelText(/Day trip/))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body)
    .toMatchObject({ visitAfter: '20:00', visitBefore: '23:30', dayTrip: true }))
  expect(calls.find((c) => c.method === 'PUT')?.body).not.toHaveProperty('hintsSource')
})

it('reorders a day with the move buttons', async () => {
  const calls = api()
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Move Meiji Jingu down' }))
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/order'))?.body).toEqual({ ids: ['Cat Street', 'Meiji Jingu'] }))
  expect(screen.getByRole('button', { name: 'Move Meiji Jingu up' })).toBeDisabled()
})

it('selects from the map and day chips', async () => {
  api()
  renderAt('/trips/t1', routes)
  Element.prototype.scrollIntoView = vi.fn()
  await userEvent.click(await screen.findByRole('button', { name: 'marker Senso-ji' }))
  expect(document.querySelector('[data-stop="Senso-ji"]')).toHaveAttribute('data-selected', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'All days' }))
  expect(screen.getByRole('button', { name: 'All days' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Day 3' }))
  expect(screen.getByRole('article', { name: 'Day 3' })).toHaveAttribute('data-active', 'true')
  await userEvent.click(within(screen.getByRole('article', { name: 'Day 1' })).getByRole('button', { name: /^Meiji Jingu/ }))
  expect(screen.getByRole('article', { name: 'Day 1' })).toHaveAttribute('data-active', 'true')
})

it('adds a manually typed destination to a day', async () => {
  const calls = api()
  renderAt('/trips/t1', routes)
  await userEvent.click(within(await screen.findByRole('article', { name: 'Day 2' })).getByRole('button', { name: '+ Add' }))
  await userEvent.type(screen.getByLabelText('Place'), 'Tiny bar')
  await userEvent.click(screen.getByRole('button', { name: 'Add Directly' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/destinations'))?.body).toMatchObject({ name: 'Tiny bar', dayIndex: 1, durationMin: 60 }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Add Directly' })).not.toBeInTheDocument())
})

it('edits, locks and removes a stop', async () => {
  const calls = api()
  renderAt('/trips/t1', routes)
  const day1 = await screen.findByRole('article', { name: 'Day 1' })
  await userEvent.click(within(day1).getAllByRole('button', { name: 'Edit' })[1])
  const time = screen.getByLabelText('Time')
  await userEvent.clear(time)
  await userEvent.type(time, '13:30')
  await userEvent.selectOptions(screen.getByLabelText('Flexibility'), 'FIXED')
  await userEvent.selectOptions(screen.getByLabelText('Day'), '2')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('Cat Street'))?.body)
    .toMatchObject({ startTime: '13:30', flexibility: 'FIXED', dayIndex: 2, locked: true }))

  await userEvent.click(within(day1).getAllByRole('button', { name: 'Edit' })[1])
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
})

it('viewers get a read-only plan', async () => {
  api({ role: 'VIEWER' })
  renderAt('/trips/t1', routes)
  const day1 = await screen.findByRole('article', { name: 'Day 1' })
  expect(within(day1).queryByRole('button', { name: '+ Add' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Add Destination/ })).not.toBeInTheDocument()
  await userEvent.click(within(day1).getAllByRole('button', { name: 'Details' })[0])
  expect(screen.getByLabelText('Name')).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
})

it('destinations tab filters and schedules ideas', async () => {
  const calls = api()
  renderAt('/trips/t1/destinations', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Unscheduled · 1' }))
  expect(screen.getByText('Golden Gai')).toBeInTheDocument()
  expect(screen.getByText('Unscheduled · Best after 20:00')).toBeInTheDocument()
  expect(screen.queryByText('Senso-ji')).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Add Golden Gai to day'), '1')
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ name: 'Golden Gai', dayIndex: 1 }))

  await userEvent.click(screen.getByRole('button', { name: 'Scheduled · 4' }))
  expect(screen.getByText('Day 1 · Thu, Jun 10 · 12:00')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Add Destination/ }))
  expect(screen.getByLabelText('Day')).toHaveValue('')
})

it('shows not-found errors', async () => {
  mockApi({ 'GET /api/trips/t1/destinations': () => json(200, []) })
  renderAt('/trips/t1', routes)
  expect(await screen.findByRole('alert')).toHaveTextContent('not found')
})

it('shows the empty-trip prompt', async () => {
  mockApi({ 'GET /api/trips/t1': () => json(200, trip()), 'GET /api/trips/t1/destinations': () => json(200, []) })
  renderAt('/trips/t1', routes)
  expect(await screen.findByText('Start with the places you want to go')).toBeInTheDocument()
})
