import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { json, mockApi, renderAt, trip } from '../test-utils'
import { timeAgo } from './CollabTabs'
import { JoinPage } from './JoinPage'
import { TripPage } from './TripPage'

vi.mock('../map/TripMap', () => ({ TripMap: () => null }))
afterEach(() => vi.unstubAllGlobals())

const routes = (
  <>
    <Route path="/trips" element={<h1>Home</h1>} />
    <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
    <Route path="/trips/:tripId/members" element={<TripPage tab="members" />} />
    <Route path="/trips/:tripId/activity" element={<TripPage tab="activity" />} />
    <Route path="/join/:token" element={<JoinPage />} />
  </>
)
const ok = () => new Response(null, { status: 204 })

it('join page previews the trip and joins', async () => {
  const calls = mockApi({
    'GET /api/invites/tok': () => json(200, { tripId: 't1', name: 'Japan 2027', startDate: '2027-06-10', endDate: '2027-06-12', cities: ['Tokyo'], memberCount: 3, member: false }),
    'POST /api/invites/tok/join': () => json(200, { tripId: 't1' }),
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, []),
  })
  renderAt('/join/tok', routes)
  expect(await screen.findByRole('heading', { name: 'Japan 2027' })).toBeInTheDocument()
  expect(screen.getByText('3 members')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Join Trip' }))
  expect(await screen.findByRole('article', { name: 'Day 1' })).toBeInTheDocument()
  expect(calls.some((c) => c.url === '/api/invites/tok/join')).toBe(true)
})

it('join page handles members and dead links', async () => {
  mockApi({ 'GET /api/invites/tok': () => json(200, { tripId: 't1', name: 'J', startDate: '2027-06-10', endDate: '2027-06-12', cities: [], memberCount: 1, member: true }) })
  const first = renderAt('/join/tok', routes)
  expect(await screen.findByRole('link', { name: /already in/ })).toHaveAttribute('href', '/trips/t1')
  first.unmount()
  mockApi({ 'GET /api/invites/dead': () => json(404, { detail: 'This invite link is invalid or has been turned off' }) })
  renderAt('/join/dead', routes)
  expect(await screen.findByText(/turned off\. Ask a trip member/)).toBeInTheDocument()
})

it('invite dialog creates a copyable link and owners can turn links off', async () => {
  const calls = mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, []),
    'POST /api/trips/t1/invites': () => json(201, { token: 'abc', expiresAt: '2027-01-01T00:00:00Z' }),
    'DELETE /api/trips/t1/invites': ok,
  })
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Invite' }))
  await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }))
  expect(await screen.findByLabelText('Invite link')).toHaveValue(`${window.location.origin}/join/abc`)
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/abc`)
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Turn off all links' }))
  expect(await screen.findByText('All links turned off.')).toBeInTheDocument()
  expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
})

it('viewers see no invite button; editors do not see turn-off', async () => {
  mockApi({ 'GET /api/trips/t1': () => json(200, trip({ role: 'VIEWER' })), 'GET /api/trips/t1/destinations': () => json(200, []) })
  const v = renderAt('/trips/t1', routes)
  await screen.findByRole('article', { name: 'Day 1' })
  expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()
  v.unmount()
  mockApi({ 'GET /api/trips/t1': () => json(200, trip({ role: 'EDITOR' })), 'GET /api/trips/t1/destinations': () => json(200, []) })
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Invite' }))
  expect(screen.queryByRole('button', { name: 'Turn off all links' })).not.toBeInTheDocument()
})

it('owner changes roles and removes members; members can leave', async () => {
  const calls = mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, []),
    'PUT /api/trips/t1/members/u2': ok,
    'DELETE /api/trips/t1/members/u3': ok,
    'DELETE /api/trips/t1/members/u1': () => json(400, { detail: 'Make someone else an owner first' }),
  })
  renderAt('/trips/t1/members', routes)
  await userEvent.selectOptions(await screen.findByLabelText('Role for Mina'), 'VIEWER')
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ role: 'VIEWER' }))
  const kenji = screen.getByText('Kenji').closest('li')!
  await userEvent.click(within(kenji).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('u3'))).toBe(true))
  await userEvent.click(screen.getByRole('button', { name: 'Leave trip' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Make someone else an owner first')
})

it('a member leaving goes home; non-owners see roles read-only', async () => {
  mockApi({
    'GET /api/trips/t1': () => json(200, trip({ role: 'EDITOR', members: [{ userId: 'u1', displayName: 'Win', role: 'EDITOR' }, { userId: 'u9', displayName: 'Ana', role: 'OWNER' }] })),
    'GET /api/trips/t1/destinations': () => json(200, []),
    'DELETE /api/trips/t1/members/u1': ok,
  })
  renderAt('/trips/t1/members', routes)
  expect(await screen.findByText('Owner')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Leave trip' }))
  expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
})

it('activity lists changes and undoes one', async () => {
  const now = Date.now()
  const calls = mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, []),
    'GET /api/trips/t1/events': () => json(200, [
      { id: 3, actorId: 'u2', actorName: 'Mina', type: 'DESTINATION_ADDED', summary: 'added Tsukiji to Day 3', createdAt: new Date(now - 5 * 60e3).toISOString(), undoable: true, undone: false },
      { id: 2, actorId: null, actorName: null, type: 'DESTINATION_REMOVED', summary: 'removed Bar', createdAt: new Date(now).toISOString(), undoable: false, undone: true },
    ]),
    'POST /api/trips/t1/events/3/undo': () => json(409, { detail: 'It changed since; undo would overwrite newer edits' }),
  })
  renderAt('/trips/t1/activity', routes)
  expect(await screen.findByText('added Tsukiji to Day 3')).toBeInTheDocument()
  expect(screen.getByText('Someone')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('undo would overwrite')
  expect(calls.some((c) => c.url.endsWith('/undo'))).toBe(true)
})

it('activity loads older changes a page at a time', async () => {
  const event = (id: number) => ({ id, actorId: 'u2', actorName: 'Mina', type: 'DESTINATION_ADDED', summary: `change ${id}`,
    createdAt: new Date().toISOString(), undoable: false, undone: false })
  const calls = mockApi({
    'GET /api/trips/t1': () => json(200, trip()),
    'GET /api/trips/t1/destinations': () => json(200, []),
    'GET /api/trips/t1/events': (_, url) => json(200, url.includes('before=71')
      ? [event(70)] : Array.from({ length: 30 }, (_, i) => event(100 - i))),
  })
  renderAt('/trips/t1/activity', routes)
  expect(await screen.findByText('change 100')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show older' }))
  expect(await screen.findByText('change 70')).toBeInTheDocument()
  expect(calls.filter((c) => c.url.includes('/events')).map((c) => c.url.split('?')[1])).toEqual(['limit=30', 'limit=30&before=71'])
  expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
})

it('formats relative times', () => {
  const now = Date.parse('2027-06-10T12:00:00Z')
  expect(timeAgo('2027-06-10T11:59:30Z', now)).toBe('just now')
  expect(timeAgo('2027-06-10T11:55:00Z', now)).toBe('5 minutes ago')
  expect(timeAgo('2027-06-10T09:00:00Z', now)).toBe('3 hours ago')
  expect(timeAgo('2027-06-08T12:00:00Z', now)).toBe('2 days ago')
})
