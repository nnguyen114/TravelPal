import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { Landing } from './Landing'

const renderLanding = () => render(<MemoryRouter><Landing /></MemoryRouter>)

it('pitches the app and points every call to action at sign-up', () => {
  renderLanding()
  for (const name of ['Start planning', "Start planning, it's free", 'Plan your first trip']) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', '/signup')
  }
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  expect(screen.getByRole('heading', { name: 'Built for trips with more than one opinion' })).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(7)
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
