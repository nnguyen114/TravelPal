import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { dest, entry, json, mockApi, renderAt, trip } from '../test-utils'
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

function api(over: Partial<Parameters<typeof trip>[0]> = {}, extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /api/trips/t1': () => json(200, trip(over)),
    'GET /api/trips/t1/destinations': () => json(200, stops),
    'PUT /api/trips/t1/days/0/order': () => json(200, []),
    'POST /api/trips/t1/destinations': (b) => json(201, b),
    'PUT /api/trips/t1/destinations/Cat Street': (b) => json(200, b),
    'PUT /api/trips/t1/destinations/Golden Gai': (b) => json(200, b),
    'DELETE /api/trips/t1/destinations/Cat Street': () => new Response(null, { status: 204 }),
    ...extra,
  })
}

it('renders the day-by-day plan with header, locks, and unscheduled count', async () => {
  api()
  renderAt('/trips/t1', routes)
  expect(await screen.findByRole('heading', { name: 'Japan 2027' })).toBeInTheDocument()
  expect(screen.getByText('Jun 10 – 12')).toBeInTheDocument()
  // You (Win) appear on the right; the stack shows the other three.
  expect(screen.getByLabelText('4 members')).toHaveTextContent('MKL')
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
  await userEvent.click(within(await screen.findByRole('article', { name: 'Day 2' })).getByRole('button', { name: 'Add a place to Day 2' }))
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
  expect(screen.getByRole('button', { name: /^Golden Gai Best after 20:00, ?Idea$/ })).toBeInTheDocument()
  expect(screen.queryByText('Senso-ji')).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Add Golden Gai to day'), '1')
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ name: 'Golden Gai', dayIndex: 1 }))

  await userEvent.click(screen.getByRole('button', { name: 'Scheduled · 4' }))
  const cat = screen.getByRole('button', { name: /^Cat Street 12:00, ?Day 1$/ })
  expect(cat.closest('li')).toHaveStyle({ '--c': '#14A098' })
  await userEvent.click(screen.getByRole('button', { name: /Add Destination/ }))
  expect(screen.getByLabelText('Day')).toHaveValue('')
})

it('shows a failed day assignment on its row, with Retry for the chosen day', async () => {
  let tries = 0
  const calls = api({}, { 'PUT /api/trips/t1/destinations/Golden Gai': (b) => (tries++ ? json(200, b) : json(500, { detail: 'Network hiccup' })) })
  renderAt('/trips/t1/destinations', routes)
  const pick = await screen.findByLabelText('Add Golden Gai to day')
  await userEvent.selectOptions(pick, '1')
  const row = pick.closest('li')!
  expect(await within(row).findByRole('alert')).toHaveTextContent('Network hiccup')
  expect(pick).toHaveValue('1')
  await userEvent.click(within(row).getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(within(row).queryByRole('alert')).not.toBeInTheDocument())
  expect(calls.filter((c) => c.method === 'PUT').map((c) => (c.body as { dayIndex: number }).dayIndex)).toEqual([1, 1])
})

it('fits every idea into days with one optimizer run', async () => {
  const calls = mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, [...stops, dest('Tsukiji', null, null)]),
    'POST /api/trips/t1/optimize': () => json(201, { id: 'pv1' }),
  })
  renderAt('/trips/t1/destinations', routes)
  expect(await screen.findByText("2 ideas aren't on a day yet")).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Relaxed' }))
  await userEvent.click(screen.getByRole('button', { name: /Fit into days/ }))
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/optimize'))?.body).toEqual({
    mode: 'RELAXED', scope: 'SELECTION', destinationIds: ['Golden Gai', 'Tsukiji'],
  }))
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

it('keeps long trips tidy: a day picker instead of chips, and slim rows for open days', async () => {
  api({ endDate: '2027-07-05', dayCount: 26 })
  renderAt('/trips/t1', routes)
  const picker = await screen.findByRole('group', { name: 'Show day on map' })
  expect(within(picker).queryByRole('button', { name: 'Day 7' })).not.toBeInTheDocument()
  const select = within(picker).getByRole('combobox', { name: 'Day shown on map' })
  expect(within(select).getAllByRole('option')).toHaveLength(27)
  expect(select).toHaveValue('0')
  expect(within(picker).getByRole('button', { name: 'Previous day' })).toBeDisabled()

  await userEvent.click(within(picker).getByRole('button', { name: 'Next day' }))
  expect(select).toHaveValue('1')
  await userEvent.selectOptions(select, '25')
  expect(within(picker).getByRole('button', { name: 'Next day' })).toBeDisabled()
  await userEvent.click(within(picker).getByRole('button', { name: 'All days' }))
  expect(select).toHaveValue('all')

  // Day 2 has nothing planned: one slim row with its own add button.
  const day2 = screen.getByRole('article', { name: 'Day 2' })
  expect(day2).toHaveClass('day-empty')
  expect(within(day2).getByText('Nothing planned yet.')).toBeInTheDocument()
})

it('marks places without a map location and lets you place them from the edit dialog', async () => {
  const unlocated = dest('Kamakura', 1, 0, { lat: null, lng: null, address: null })
  const calls = mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, [unlocated]),
    'GET /api/places/search': () => json(200, [{ name: 'Kamakura', address: 'Kanagawa, Japan', lat: 35.32, lng: 139.55, providerId: 'osm:R1' }]),
    'PUT /api/trips/t1/destinations/Kamakura': (b) => json(200, b),
  })
  renderAt('/trips/t1', routes)
  const day2 = await screen.findByRole('article', { name: 'Day 2' })
  expect(within(day2).getByText(/not on the map yet/)).toBeInTheDocument()

  await userEvent.click(within(day2).getByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Kamakura' })
  // It looks the name up straight away; picking a match puts the place on the map when saved.
  await userEvent.click(await within(dialog).findByRole('button', { name: /Kanagawa, Japan/ }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body)
    .toMatchObject({ lat: 35.32, lng: 139.55, address: 'Kanagawa, Japan', providerId: 'osm:R1', dayIndex: 1 }))
})

const entries = [
  entry('LAX → HND', 0, { kind: 'FLIGHT', startTime: '10:15:00', details: { from: 'LAX', to: 'HND', arrivesDay: 1, arrives: '15:20' } }),
  entry('Vincent bday', 1),
  entry('Dinner', 1, { kind: 'MEAL', position: 2, startTime: '19:00:00', details: { slot: 'DINNER', areas: ['Ebisu', 'Nakameguro'] } }),
  entry('Check in hotel', 1, { kind: 'LODGING', position: 1, startTime: '15:00:00', details: { action: 'CHECK_IN', hotel: null } }),
  entry('Something in between', 1, { kind: 'CHOICE', position: 3, details: { options: [
    { label: 'Shibuya Sky', place: null }, { label: 'Pokemon Center', place: null }], resolved: false } }),
  entry('Pack an adapter', null),
]

it('shows entries on day cards: notes first, then by time, with Choose on a choice', async () => {
  const calls = api({}, {
    'GET /api/trips/t1/entries': () => json(200, entries),
    'POST /api/trips/t1/entries/Something in between/choose': () => json(200, dest('Pokemon Center', 1, 0)),
  })
  renderAt('/trips/t1', routes)
  const day1 = await screen.findByRole('article', { name: 'Day 1' })
  expect(within(day1).getByText('arrives Jun 11, 3:20 PM')).toBeInTheDocument()
  // Day 2 had no stops; its entries still give it a full card.
  const day2 = screen.getByRole('article', { name: 'Day 2' })
  expect(within(day2).queryByText('Nothing planned yet.')).not.toBeInTheDocument()
  const rows = within(within(day2).getByRole('list', { name: 'Plans and notes' })).getAllByRole('listitem')
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringContaining('Vincent bday'), expect.stringContaining('Check in hotel'), expect.stringContaining('Ebisu or Nakameguro'),
    expect.stringContaining('Something in between')])
  expect(within(rows[1]).getByText('Check-in')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Not on a day' })).toHaveTextContent('Pack an adapter')

  await userEvent.click(within(day2).getByRole('button', { name: 'Choose Pokemon Center' }))
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/choose'))?.body).toEqual({ option: 1 }))
})

it('edits and removes an entry, and viewers only read', async () => {
  const calls = api({}, {
    'GET /api/trips/t1/entries': () => json(200, entries),
    'PUT /api/trips/t1/entries/Vincent bday': (b) => json(200, b),
    'DELETE /api/trips/t1/entries/Vincent bday': () => new Response(null, { status: 204 }),
  })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Vincent bday' }))
  const title = screen.getByLabelText('Title')
  await userEvent.clear(title)
  await userEvent.type(title, "Vincent's birthday")
  await userEvent.type(screen.getByLabelText('Time'), '19:00')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url.includes('/entries/'))?.body)
    .toEqual({ version: 0, title: "Vincent's birthday", dayIndex: 1, startTime: '19:00' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Vincent bday' }))
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/entries/Vincent bday?version=0'))).toBe(true))
})

it('viewers see entries without edit or choose buttons', async () => {
  api({ role: 'VIEWER' }, { 'GET /api/trips/t1/entries': () => json(200, entries) })
  renderAt('/trips/t1', routes)
  const day2 = await screen.findByRole('article', { name: 'Day 2' })
  expect(within(day2).getByText('Shibuya Sky')).toBeInTheDocument()
  expect(within(day2).queryByRole('button', { name: /Choose|Edit/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Import' })).not.toBeInTheDocument()
})

it('after an import, opens on its first day with a toast whose Undo reverses it', async () => {
  const calls = api({}, { 'POST /api/trips/t1/events/7/undo': () => new Response(null, { status: 204 }) })
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  const imported = { tripId: 't1', firstDayIndex: 2, added: { places: 2, entries: 1 }, skipped: [{ name: 'Senso-ji', reason: 'Already in this trip' }], eventId: 7 }
  renderAt({ pathname: '/trips/t1', state: { imported } }, routes)
  const toast = await screen.findByText('Imported 2 places and 1 note. 1 place already in the trip was skipped.')
  expect(screen.getByRole('article', { name: 'Day 3' })).toHaveAttribute('data-active', 'true')
  expect(scroll).toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/trips/t1/import')
  await userEvent.click(within(toast.closest('.toast') as HTMLElement).getByRole('button', { name: 'Undo' }))
  expect(await screen.findByText('Import undone.')).toBeInTheDocument()
  // Its own event, straight away: no lookup that could pick up another import.
  expect(calls.filter((c) => c.url.includes('/events')).map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/trips/t1/events/7/undo'])
})

it('offers Same day in the edit dialog', async () => {
  const calls = api()
  renderAt('/trips/t1', routes)
  const day1 = await screen.findByRole('article', { name: 'Day 1' })
  await userEvent.click(within(day1).getAllByRole('button', { name: 'Edit' })[0])
  await userEvent.selectOptions(screen.getByLabelText('Flexibility'), 'Same day')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ flexibility: 'SAME_DAY' }))
})
