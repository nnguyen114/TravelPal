import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { dest, json, mockApi, renderAt, trip } from '../test-utils'
import type { Proposal } from '../types'
import { describe as describeChange } from './Suggestions'
import { TripPage } from './TripPage'

vi.mock('../map/TripMap', () => ({ TripMap: () => null }))
afterEach(() => vi.unstubAllGlobals())

const routes = (
  <>
    <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
    <Route path="/trips/:tripId/suggestions" element={<TripPage tab="suggestions" />} />
    <Route path="/trips/:tripId/suggestions/:proposalId" element={<TripPage tab="suggestions" />} />
  </>
)
const prop = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p1', title: 'Add Tsukiji Outer Market', description: 'Breakfast before Senso-ji?', status: 'OPEN',
  authorId: 'u2', authorName: 'Mina', createdAt: new Date().toISOString(), closedAt: null,
  changes: [{ kind: 'ADD', destinationId: null, name: 'Tsukiji Outer Market', fromDay: null, dayIndex: 2, startTime: '08:00:00' }],
  affectedDays: [2], commentCount: 1, stale: false, impact: null, impactByName: null,
  comments: [{ id: 'c1', authorId: 'u3', authorName: 'Kenji', body: 'In. Can we keep the slow morning though?', createdAt: new Date().toISOString() }],
  ...over,
})
const list = [prop({ comments: null }), prop({ id: 'p2', title: 'Swap days', status: 'MERGED', comments: null, commentCount: 0, affectedDays: [1, 3] })]

function setup(role: 'OWNER' | 'VIEWER' = 'OWNER', detail = prop()) {
  return mockApi({
    'GET /api/trips/t1': () => json(200, trip({ role })),
    'GET /api/trips/t1/destinations': () => json(200, [dest('Senso-ji', 2, 0), dest('Golden Gai', null, null)]),
    'GET /api/trips/t1/proposals': () => json(200, list),
    'GET /api/trips/t1/proposals/p1': () => json(200, detail),
    'GET /api/trips/t1/proposals/p2': () => json(200, prop({ id: 'p2', title: 'Swap days', status: 'MERGED' })),
    'POST /api/trips/t1/proposals/p1/impact': () => json(200, prop({
      impact: { fits: 'Yes: Tsukiji on Day 3 at 08:00', conflicts: 'None with locks', dayEffect: 'Senso-ji moves to 10:00', basis: 'Estimated…' },
      impactByName: 'Win',
    })),
    'POST /api/trips/t1/proposals/p1/comments': (b) => json(201, prop({ comments: [...prop().comments!, { id: 'c2', authorId: 'u1', authorName: 'Win', body: (b as { body: string }).body, createdAt: new Date().toISOString() }] })),
    'POST /api/trips/t1/proposals/p1/merge': () => json(200, prop({ status: 'MERGED' })),
    'POST /api/trips/t1/proposals/p1/close': () => json(200, prop({ status: 'CLOSED' })),
    'POST /api/trips/t1/proposals': () => json(201, prop({ id: 'p1' })),
  })
}

it('lists proposals by status with the open count in the tab', async () => {
  setup()
  renderAt('/trips/t1/suggestions', routes)
  expect(await screen.findByRole('button', { name: 'Open · 1' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByLabelText('1 open')).toBeInTheDocument()
  expect(screen.getByText('Mina · Day 3 · 1 comment')).toBeInTheDocument()
  expect(await screen.findByRole('article', { name: 'Add Tsukiji Outer Market' })).toBeInTheDocument()
  expect(screen.getByText('Proposed by Mina · affects Day 3')).toBeInTheDocument()
  expect(screen.getByText('Add Tsukiji Outer Market to Day 3 at 08:00')).toBeInTheDocument()
  expect(screen.getByText('In. Can we keep the slow morning though?')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Merged · 1' }))
  expect(screen.getByText('Mina · Days 2, 4 · 0 comments')).toBeInTheDocument()
})

it('checks impact, comments, and merges', async () => {
  const calls = setup()
  renderAt('/trips/t1/suggestions/p1', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Check impact' }))
  expect(await screen.findByText('Yes: Tsukiji on Day 3 at 08:00')).toBeInTheDocument()
  expect(screen.getByText('Senso-ji moves to 10:00')).toBeInTheDocument()
  expect(screen.getByText('requested by Win')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Add a comment'), 'Works for me')
  await userEvent.click(screen.getByRole('button', { name: 'Post' }))
  expect(await screen.findByText('Works for me')).toBeInTheDocument()
  expect(screen.getByLabelText('Add a comment')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Accept and Merge' }))
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/merge'))).toBe(true))
  expect(await screen.findByText('MERGED')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Merged/ })).toHaveAttribute('aria-pressed', 'true'))
})

it('stale proposals cannot merge; viewers only close their own', async () => {
  setup('VIEWER', prop({ stale: true, authorId: 'u1' }))
  renderAt('/trips/t1/suggestions/p1', routes)
  expect(await screen.findByText(/changed since it was made/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Accept and Merge' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(await screen.findByText('CLOSED')).toBeInTheDocument()
})

it('creates a multi-change proposal', async () => {
  const calls = setup()
  renderAt('/trips/t1/suggestions', routes)
  await userEvent.click(await screen.findByRole('button', { name: /New proposal/ }))
  const dialog = screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText('Title'), 'Rework day 3')
  await userEvent.type(within(dialog).getByLabelText('Place'), 'Tiny bar')
  await userEvent.selectOptions(within(dialog).getByLabelText('Day'), '2')
  await userEvent.click(within(dialog).getByRole('button', { name: '+ Add another change' }))
  const [, second] = within(dialog).getAllByLabelText('What')
  await userEvent.selectOptions(second, 'MOVE')
  await userEvent.selectOptions(within(dialog).getByLabelText('Place', { selector: 'select' }), 'Senso-ji')
  await userEvent.selectOptions(within(dialog).getByLabelText('Move to'), '1')
  await userEvent.click(within(dialog).getByRole('button', { name: '+ Add another change' }))
  await userEvent.selectOptions(within(dialog).getAllByLabelText('What')[2], 'REMOVE')
  await userEvent.selectOptions(within(dialog).getAllByLabelText('Place', { selector: 'select' })[1], 'Golden Gai')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Propose to Group' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/proposals'))?.body).toEqual({
    title: 'Rework day 3', description: null, changes: [
      { kind: 'ADD', name: 'Tiny bar', dayIndex: 2 },
      { kind: 'MOVE', destinationId: 'Senso-ji', dayIndex: 1 },
      { kind: 'REMOVE', destinationId: 'Golden Gai', dayIndex: null },
    ],
  }))
})

it('Add Destination can propose instead of adding directly', async () => {
  const calls = setup()
  renderAt('/trips/t1', routes)
  await userEvent.click(await screen.findByRole('button', { name: /Add Destination/ }))
  await userEvent.type(screen.getByLabelText('Place'), 'Tsukiji')
  await userEvent.click(screen.getByRole('button', { name: 'Propose to Group' }))
  await waitFor(() => expect(calls.find((c) => c.url.endsWith('/proposals') && c.method === 'POST')?.body)
    .toMatchObject({ title: 'Add Tsukiji', changes: [{ kind: 'ADD', name: 'Tsukiji', durationMin: 60 }] }))
  expect(await screen.findByRole('article', { name: 'Add Tsukiji Outer Market' })).toBeInTheDocument()
})

it('describes every kind of change', () => {
  const c = { destinationId: 'x', name: 'X', fromDay: null, dayIndex: null, startTime: null }
  expect(describeChange({ ...c, kind: 'ADD' })).toBe('Add X as an idea')
  expect(describeChange({ ...c, kind: 'MOVE' })).toBe('Move X from Unscheduled to Unscheduled')
  expect(describeChange({ ...c, kind: 'MOVE', fromDay: 0, dayIndex: 1, startTime: '10:00:00' })).toBe('Move X from Day 1 to Day 2 at 10:00')
  expect(describeChange({ ...c, kind: 'REMOVE' })).toBe('Remove X')
})
