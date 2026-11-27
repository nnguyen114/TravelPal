import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth'
import { json, mockApi, trip } from '../test-utils'
import type { Draft } from '../types'
import { ImportPage } from './ImportPage'

afterEach(() => vi.unstubAllGlobals())

const cand = (name: string, id: string) => ({ name, address: 'Tokyo, Japan', lat: 35.7, lng: 139.8, providerId: `geoapify:${id}` })
const place = (title: string, over: object = {}) =>
  ({ kind: 'PLACE' as const, title, time: null, city: null, note: null, day_trip: false, candidates: [cand(title, title)], source: title, ...over })

/** The Tokyo plan (docs/IMPORT_SPEC.md §9) as ai-service drafts it. */
const TOKYO: Draft = {
  name: 'Tokyo', year_assumed: true,
  days: [
    { date: '2026-12-24', city: 'Tokyo', items: [{ kind: 'FLIGHT', title: 'LAX → HND', time: '10:15', source: 'Flight LAX → HND\nLAX: 10:15AM',
      details: { from: 'LAX', to: 'HND', number: null, departs: '10:15', departTz: 'America/Los_Angeles', arrivesDay: 1, arrives: '15:20', arriveTz: 'Asia/Tokyo' } }] },
    { date: '2026-12-25', city: 'Tokyo', items: [
      { kind: 'LODGING', title: 'Check in hotel', time: null, source: 'Check in hotel', details: { action: 'CHECK_IN', hotel: null } },
      place('Senso-ji', { source: 'Explore senso-ji (temple)' }), place('Daikoku PA', { note: 'night' })] },
    { date: '2026-12-26', city: 'Tokyo', items: [
      { kind: 'MEAL', title: 'Breakfast', time: null, source: 'Breakfast ( Ueno or Asakusa)', details: { slot: 'BREAKFAST', areas: ['Ueno', 'Asakusa'] } }] },
    { date: '2026-12-27', city: 'Tokyo', items: [
      place('Omakase', { time: '20:30', note: '$20 reserve', candidates: [] }),
      { kind: 'CHOICE', title: 'Something in between', time: null, source: 'Group Deicison For something in Between',
        details: { options: [{ label: 'Shibuya Sky', place: cand('Shibuya Sky', 'sky') }, { label: 'Pokemon Center', place: null }], resolved: false } },
      place('Sushi Rizaki Ebisu', { time: '20:30', candidates: [] }),
      place('Golden Gai', { candidates: [cand('Golden Gai', 'gg1'), cand('Shinjuku Golden Gai Bar', 'gg2')] }),
      { kind: 'NOTE', title: 'Vincent bday', time: null, source: '- Vincent bday', details: {} }] },
    { date: '2026-12-28', city: 'Tokyo', items: [place('Kamakura', { day_trip: true, city: 'Kamakura' })] },
  ],
  undated: [{ kind: 'NOTE', title: 'Pack an adapter', time: null, source: null, details: {} }],
  cities: [{ name: 'Tokyo', lat: 35.68, lng: 139.76, startDate: '2026-12-24', endDate: '2026-12-28' }],
  issues: [
    { date: '2026-12-24', item: null, kind: 'YEAR_ASSUMED', message: "The plan doesn't say the year, so we assumed 2026. Check the dates." },
    { date: '2026-12-27', item: 2, kind: 'TIME_CLASH', message: 'Omakase and Sushi Rizaki Ebisu are both at 8:30 PM.' },
    { date: '2026-12-27', item: 3, kind: 'MANY_MATCHES', message: 'Golden Gai has more than one possible match.' },
  ],
}
const RESULT = { tripId: 'new1', firstDayIndex: 0, added: { places: 6, entries: 6 }, skipped: [] }

function TripStub() {
  const state = useLocation().state as { imported?: { tripId: string } } | null
  return <p>Trip page, imported {state?.imported?.tripId}</p>
}

function renderAt(path: string) {
  const router = createMemoryRouter([
    { path: '/import', element: <ImportPage /> },
    { path: '/trips/:tripId/import', element: <ImportPage /> },
    { path: '/trips/:tripId', element: <TripStub /> },
    { path: '/trips', element: <p>My Trips page</p> },
  ], { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider><RouterProvider router={router} /></AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

async function readPlan(text = 'DEC 24\nFlight LAX → HND') {
  await userEvent.type(await screen.findByLabelText('Paste your plan'), text)
  await userEvent.click(screen.getByRole('button', { name: 'Read my plan' }))
  return screen.findByRole('heading', { name: 'Review your plan' })
}

it('reviews the Tokyo draft by day with issues that link to their rows', async () => {
  const calls = mockApi({ 'POST /api/imports/read': () => json(200, TOKYO) })
  renderAt('/import')
  const heading = await readPlan()
  expect(heading).toHaveFocus()
  const form = calls.find((c) => c.url === '/api/imports/read')!.body as FormData
  expect(form.get('text')).toBe('DEC 24\nFlight LAX → HND')
  expect(form.get('tripId')).toBeNull()

  expect(screen.getByLabelText('Trip name')).toHaveValue('Tokyo')
  expect(screen.getByLabelText('Start')).toHaveValue('2026-12-24')
  expect(screen.getByLabelText('End')).toHaveValue('2026-12-28')
  const dec24 = screen.getByRole('region', { name: 'Thu, Dec 24' })
  expect(within(dec24).getByLabelText('Title (Flight)')).toHaveValue('LAX → HND')
  expect(within(dec24).getByText('arrives Dec 25, 3:20 PM')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Sat, Dec 26' })).getByText('Ueno or Asakusa')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Undated' })).getByLabelText('Title (Note)')).toHaveValue('Pack an adapter')
  // Timed places default to a locked time.
  expect(within(screen.getByRole('region', { name: 'Sun, Dec 27' })).getAllByLabelText('Lock time')[0]).toBeChecked()

  const issues = screen.getByRole('status')
  expect(within(issues).getByText(/assumed 2026/)).toBeInTheDocument()
  expect(within(issues).getByText('Still to decide: Something in between. It stays open after import.')).toBeInTheDocument()
  await userEvent.click(within(issues).getByRole('link', { name: 'Omakase and Sushi Rizaki Ebisu are both at 8:30 PM.' }))
  const sushi = screen.getByDisplayValue('Sushi Rizaki Ebisu').closest('li')!
  expect(sushi).toHaveFocus()

  await userEvent.click(within(screen.getByDisplayValue('Senso-ji').closest('li')!).getByRole('button', { name: 'Show source' }))
  expect(screen.getByText('Explore senso-ji (temple)')).toBeInTheDocument()
})

it('applies the edited rows, retries with the same importId, and opens the trip', async () => {
  let attempts = 0
  const calls = mockApi({
    'POST /api/imports/read': () => json(200, TOKYO),
    'POST /api/imports/apply': () => (++attempts === 1 ? json(503, { detail: 'Try again.' }) : json(200, RESULT)),
  })
  renderAt('/import')
  await readPlan()
  const gai = screen.getByDisplayValue('Golden Gai').closest('li')!
  await userEvent.click(within(gai).getByRole('radio', { name: /Shinjuku Golden Gai Bar/ }))
  const senso = screen.getByDisplayValue('Senso-ji').closest('li')!
  await userEvent.clear(within(senso).getByLabelText('Title (Place)'))
  await userEvent.type(within(senso).getByLabelText('Title (Place)'), 'Sensō-ji Temple')
  await userEvent.click(within(screen.getByDisplayValue('Daikoku PA').closest('li')!).getByRole('radio', { name: 'Keep as an idea without a map pin' }))
  const sushi = screen.getByDisplayValue('Sushi Rizaki Ebisu').closest('li')!
  await userEvent.click(within(sushi).getByLabelText('Lock time'))
  await userEvent.click(within(screen.getByDisplayValue('Pack an adapter').closest('li')!).getByRole('button', { name: 'Remove Pack an adapter' }))
  const choice = screen.getByDisplayValue('Shibuya Sky').closest('li')!
  await userEvent.click(within(choice).getByRole('button', { name: 'Remove option Pokemon Center' }))

  await userEvent.click(screen.getByRole('button', { name: 'Apply as a new trip' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again.')
  await userEvent.click(screen.getByRole('button', { name: 'Apply as a new trip' }))
  expect(await screen.findByText('Trip page, imported new1')).toBeInTheDocument()

  const applies = calls.filter((c) => c.url === '/api/imports/apply').map((c) => c.body as Record<string, any>)
  expect(applies).toHaveLength(2)
  expect(applies[1].importId).toBe(applies[0].importId)
  const body = applies[0]
  expect(body.newTrip).toEqual({ name: 'Tokyo', startDate: '2026-12-24', endDate: '2026-12-28',
    cities: [{ name: 'Tokyo', lat: 35.68, lng: 139.76, startDate: '2026-12-24', endDate: '2026-12-28' }] })
  const byName = Object.fromEntries(body.places.map((p: { name: string }) => [p.name, p]))
  expect(byName['Sensō-ji Temple']).toMatchObject({ date: '2026-12-25', position: 1, providerId: 'geoapify:Senso-ji', locked: false })
  expect(byName['Golden Gai']).toMatchObject({ providerId: 'geoapify:gg2', date: '2026-12-27', position: 3 })
  expect(byName['Daikoku PA']).toMatchObject({ providerId: null, lat: null, notes: 'night' })
  expect(byName.Omakase).toMatchObject({ startTime: '20:30', locked: true, notes: '$20 reserve' })
  expect(byName['Sushi Rizaki Ebisu']).toMatchObject({ startTime: '20:30', locked: false })
  expect(byName.Kamakura).toMatchObject({ dayTrip: true })
  expect(body.entries.map((e: { title: string }) => e.title)).toEqual(['LAX → HND', 'Check in hotel', 'Breakfast', 'Something in between', 'Vincent bday'])
  expect(body.entries[0]).toMatchObject({ kind: 'FLIGHT', date: '2026-12-24', position: 0, startTime: '10:15', details: { arrives: '15:20' } })
  expect(body.entries[3].details.options).toEqual([{ label: 'Shibuya Sky', place: cand('Shibuya Sky', 'sky') }])
})

it('moving the start date shifts every day, and dates outside the trip block Apply', async () => {
  const calls = mockApi({ 'POST /api/imports/read': () => json(200, TOKYO), 'POST /api/imports/apply': () => json(200, RESULT) })
  renderAt('/import')
  await readPlan()
  // Date inputs change in one step in a browser.
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2027-12-24' } })
  expect(screen.getByLabelText('End')).toHaveValue('2027-12-28')
  expect(screen.getByRole('region', { name: 'Fri, Dec 24' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('End'), { target: { value: '2027-12-27' } })
  expect(screen.getByText(/“Kamakura” is on Dec 28, outside the trip/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Apply as a new trip' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Kamakura' }))
  await userEvent.click(screen.getByRole('button', { name: 'Apply as a new trip' }))
  await screen.findByText('Trip page, imported new1')
  const body = calls.find((c) => c.url === '/api/imports/apply')!.body as Record<string, any>
  expect(body.newTrip.cities[0]).toMatchObject({ startDate: '2027-12-24', endDate: '2027-12-27' })
})

it('imports into an existing trip, offering to extend it', async () => {
  const calls = mockApi({
    'GET /api/trips/t1': () => json(200, trip({ startDate: '2026-12-24', endDate: '2026-12-26', dayCount: 3 })),
    'POST /api/imports/read': () => json(200, TOKYO),
    'POST /api/imports/apply': () => json(200, { ...RESULT, tripId: 't1' }),
  })
  renderAt('/trips/t1/import')
  expect(await screen.findByText(/before it's added to Japan 2027/)).toBeInTheDocument()
  await readPlan()
  expect((calls.find((c) => c.url === '/api/imports/read')!.body as FormData).get('tripId')).toBe('t1')
  const extend = screen.getByRole('checkbox', { name: 'Extend the trip to Dec 28' })
  expect(extend).toBeChecked()
  await userEvent.click(extend)
  expect(screen.getByRole('button', { name: 'Apply to Japan 2027' })).toBeDisabled()
  await userEvent.click(extend)
  await userEvent.click(screen.getByRole('button', { name: 'Apply to Japan 2027' }))
  await screen.findByText('Trip page, imported t1')
  const body = calls.find((c) => c.url === '/api/imports/apply')!.body as Record<string, any>
  expect(body).toMatchObject({ tripId: 't1', extendEndTo: '2026-12-28' })
  expect(body.newTrip).toBeUndefined()
})

it('viewers cannot import into a trip', async () => {
  mockApi({ 'GET /api/trips/t1': () => json(200, trip({ role: 'VIEWER' })) })
  renderAt('/trips/t1/import')
  expect(await screen.findByRole('alert')).toHaveTextContent('Only editors can import into this trip.')
})

it('keeps the pasted text when reading fails, and checks input first', async () => {
  const calls = mockApi({ 'POST /api/imports/read': () => json(503, { detail: 'Reading your plan is unavailable right now.' }) })
  renderAt('/import')
  await userEvent.click(await screen.findByRole('button', { name: 'Read my plan' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Paste your plan or choose a PDF first.')
  await userEvent.upload(screen.getByLabelText(/Or upload a PDF/), new File(['x'], 'plan.png', { type: 'image/png' }), { applyAccept: false })
  await userEvent.click(screen.getByRole('button', { name: 'Read my plan' }))
  expect(screen.getByRole('alert')).toHaveTextContent('That file isn’t a PDF.')
  expect(calls.some((c) => c.url === '/api/imports/read')).toBe(false)

  await userEvent.upload(screen.getByLabelText(/Or upload a PDF/), new File(['%PDF-1.7'], 'plan.pdf', { type: 'application/pdf' }))
  await userEvent.click(screen.getByRole('button', { name: 'Read my plan' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reading your plan is unavailable right now.')
  expect((calls.find((c) => c.url === '/api/imports/read')!.body as FormData).get('file')).toBeInstanceOf(File)

  await userEvent.type(screen.getByLabelText('Paste your plan'), 'DEC 25')
  await userEvent.click(screen.getByRole('button', { name: 'Read my plan' }))
  expect(screen.getByRole('alert')).toHaveTextContent('not both')
  expect(screen.getByLabelText('Paste your plan')).toHaveValue('DEC 25')
})

it('asks before leaving a review that was not applied', async () => {
  mockApi({ 'POST /api/imports/read': () => json(200, TOKYO) })
  const router = renderAt('/import')
  await readPlan()
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)

  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  await userEvent.click(screen.getByRole('link', { name: 'My Trips' }))
  expect(confirm).toHaveBeenCalledWith('Leave without importing? Your review will be lost.')
  expect(screen.getByRole('heading', { name: 'Review your plan' })).toBeInTheDocument()
  confirm.mockReturnValue(true)
  await userEvent.click(screen.getByRole('link', { name: 'My Trips' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/trips'))
})
