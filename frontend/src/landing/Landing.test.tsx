import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { Landing } from './Landing'

const renderLanding = () => render(<MemoryRouter><Landing /></MemoryRouter>)

it('points every call to action at sign-up and log in', () => {
  renderLanding()
  const signups = screen.getAllByRole('link', { name: /Plan a trip|Create an account/ })
  expect(signups.length).toBeGreaterThanOrEqual(4)
  signups.forEach((a) => expect(a).toHaveAttribute('href', '/signup'))
  screen.getAllByRole('link', { name: 'Log in' }).forEach((a) => expect(a).toHaveAttribute('href', '/login'))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Turn the group chat into a trip.')
})

it('has working little demos in the feature stories', async () => {
  renderLanding()
  await userEvent.click(screen.getByRole('button', { name: 'Before' }))
  expect(screen.getAllByText('Not planned yet')).toHaveLength(4)
  await userEvent.click(screen.getByRole('button', { name: 'After' }))
  expect(screen.getByText('Day 2 · 9:00 PM')).toBeInTheDocument()

  const like = screen.getByRole('button', { name: '👍 2' })
  await userEvent.click(like)
  expect(like).toHaveAttribute('aria-pressed', 'true')
  expect(like).toHaveTextContent('👍 3')
})

it('answers common questions', () => {
  renderLanding()
  expect(screen.getByText('Will the AI change my plan without asking?')).toBeInTheDocument()
})

it('steps through every demo chapter', async () => {
  renderLanding()
  const frame = screen.getByRole('img', { name: /Animated demo/ })
  const chapter = (name: string) => screen.getByRole('tab', { name })
  // No motion available in tests: each chapter shows its finished state.
  expect(chapter('Paste a list')).toHaveAttribute('aria-selected', 'true')

  await userEvent.click(chapter('Paste a list'))
  expect(within(frame).getByText('8 places added · not on a day yet')).toBeInTheDocument()

  await userEvent.click(chapter('AI plans the days'))
  expect(chapter('AI plans the days')).toHaveAttribute('aria-selected', 'true')
  expect(within(frame).getByText('Bar district · best after dark')).toBeInTheDocument()
  expect(within(frame).getByText('Day trip · gets its own day')).toBeInTheDocument()

  await userEvent.click(chapter('Plan together'))
  expect(within(frame).getByText('Omoide Yokocho')).toBeInTheDocument()

  await userEvent.click(chapter('Find more like it'))
  expect(within(frame).getByText('Added to Day 2 at 10:30 AM')).toBeInTheDocument()
  expect(within(frame).getByText('Added ✓')).toBeInTheDocument()

  // It never starts on its own here (no motion), but an explicit Play does.
  await userEvent.click(screen.getByRole('button', { name: 'Play demo' }))
  await userEvent.click(screen.getByRole('button', { name: 'Pause demo' }))
  expect(screen.getByRole('button', { name: 'Play demo' })).toBeInTheDocument()
})

it('turns the departures board into the first step of planning', async () => {
  renderLanding()
  const board = screen.getByRole('region', { name: 'Where are you headed?' })
  const go = () => within(board).getAllByRole('link').find((a) => a.classList.contains('board-go'))!
  expect(go()).toHaveAttribute('href', '/signup')
  expect(within(board).getByLabelText('No destination yet')).toBeInTheDocument()

  // Typing a city flips it onto the top row and carries it into sign-up.
  await userEvent.type(within(board).getByRole('textbox'), 'Kyoto')
  // The letters spin for a moment before landing.
  await waitFor(() => expect(within(board).getByLabelText('Your trip: Kyoto')).toHaveTextContent('KYOTO'))
  expect(go()).toHaveAttribute('href', '/signup?to=Kyoto')

  // Picking a departing flight does the same.
  const flights = within(board).getAllByRole('button', { name: /^Pick / })
  expect(flights).toHaveLength(4)
  await userEvent.click(within(board).getByRole('button', { name: 'Pick Tokyo' }))
  expect(within(board).getByRole('textbox')).toHaveValue('Tokyo')
  expect(go()).toHaveAttribute('href', '/signup?to=Tokyo')
  expect(flights[0]).toHaveTextContent('10:05')
})
