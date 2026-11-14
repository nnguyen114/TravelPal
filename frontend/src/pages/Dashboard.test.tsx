import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { json, mockApi, renderAt, trip } from '../test-utils'
import { Dashboard } from './Dashboard'

afterEach(() => vi.unstubAllGlobals())

const routes = (
  <>
    <Route path="/" element={<Dashboard />} />
    <Route path="/trips/:id" element={<h1>Workspace</h1>} />
  </>
)

it('lists created and joined trips as cards', async () => {
  mockApi({
    'GET /api/trips': () => json(200, [
      { id: 't1', name: 'Japan 2027', startDate: '2027-06-10', endDate: '2027-06-17', role: 'OWNER', memberCount: 5, cities: ['Tokyo', 'Kyoto'] },
      { id: 't2', name: 'Lisbon', startDate: '2027-09-02', endDate: '2027-09-05', role: 'EDITOR', memberCount: 1, cities: ['Lisbon'] },
    ]),
  })
  renderAt('/', routes)
  expect(await screen.findByRole('heading', { name: 'Japan 2027' })).toBeInTheDocument()
  expect(screen.getByText('Tokyo · Kyoto')).toBeInTheDocument()
  expect(screen.getByText('5 members')).toBeInTheDocument()
  expect(screen.getByText('1 member')).toBeInTheDocument()
  expect(screen.getByText('Created by you')).toBeInTheDocument()
  expect(screen.getByText('Joined')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open Lisbon' })).toHaveAttribute('href', '/trips/t2')
})

it('creates a trip from a searched destination and opens it', async () => {
  const calls = mockApi({
    'GET /api/trips': () => json(200, []),
    'GET /api/places/search': () => json(200, [{ name: 'Tokyo', address: 'Japan', lat: 35.68, lng: 139.76, providerId: 'osm:R1' }]),
    'POST /api/trips': () => json(201, trip()),
  })
  renderAt('/', routes)
  await userEvent.click(await screen.findByRole('button', { name: /Create Trip/ }))
  await userEvent.type(screen.getByLabelText('Trip name'), 'Japan 2027')
  await userEvent.type(screen.getByLabelText('Destination'), 'Tokyo{Enter}')
  await userEvent.click(await screen.findByRole('button', { name: /Japan/ }))
  await userEvent.type(screen.getByLabelText('Start'), '2027-06-10')
  await userEvent.type(screen.getByLabelText('End'), '2027-06-12')
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create Trip' }))

  expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
  expect(calls.find((c) => c.method === 'POST' && c.url === '/api/trips')?.body).toEqual({
    name: 'Japan 2027', startDate: '2027-06-10', endDate: '2027-06-12', destination: { name: 'Tokyo', lat: 35.68, lng: 139.76 },
  })
})

it('shows create errors and load errors', async () => {
  mockApi({
    'GET /api/trips': () => json(500, { detail: 'Server unavailable' }),
    'POST /api/trips': () => json(400, { detail: 'End date is before start date' }),
  })
  renderAt('/', routes)
  expect(await screen.findByText('Server unavailable')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Start a new trip/ }))
  await userEvent.type(screen.getByLabelText('Trip name'), 'X')
  await userEvent.type(screen.getByLabelText('Destination'), 'Nowhere')
  expect(screen.getByText(/added as typed/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Start'), '2027-06-10')
  await userEvent.type(screen.getByLabelText('End'), '2027-06-01')
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create Trip' }))
  await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent === 'End date is before start date')).toBe(true))
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByLabelText('Trip name')).not.toBeInTheDocument()
})

it('deletes the account only with the password and signs out', async () => {
  const calls = mockApi({
    'GET /api/trips': () => json(200, []),
    'DELETE /api/me': (body) => ((body as { password: string }).password === 'right-password'
      ? new Response(null, { status: 204 }) : json(403, { detail: 'Password is incorrect' })),
  })
  renderAt('/', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Your account' }))
  const dialog = screen.getByRole('dialog', { name: 'Your account' })
  await userEvent.type(within(dialog).getByLabelText('Password'), 'wrong')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Password is incorrect')

  await userEvent.clear(within(dialog).getByLabelText('Password'))
  await userEvent.type(within(dialog).getByLabelText('Password'), 'right-password')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }))
  await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2))
})

it('opens Create Trip already filled in when a city was picked on the landing page', async () => {
  const calls = mockApi({
    'GET /api/trips': () => json(200, []),
    'GET /api/places/search': () => json(200, [{ name: 'Lisbon', address: 'Portugal', lat: 38.72, lng: -9.14, providerId: 'osm:R1' }]),
  })
  renderAt('/?to=Lisbon', routes)
  const dialog = await screen.findByRole('dialog', { name: 'Create a trip' })
  expect(within(dialog).getByLabelText('Trip name')).toHaveValue('Lisbon trip')
  expect(within(dialog).getByLabelText('Destination')).toHaveValue('Lisbon')
  // It looks the place up straight away, so the visitor just picks it.
  expect(await within(dialog).findByRole('button', { name: /Lisbon/ })).toBeInTheDocument()
  expect(calls.some((c) => c.url.startsWith('/api/places/search?q=Lisbon'))).toBe(true)
})
