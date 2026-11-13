import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const session = { accessToken: 't', user: { id: '1', email: 'win@example.com', displayName: 'Win' } }

afterEach(() => vi.unstubAllGlobals())

it('shows login when there is no session, logs in, then logs out', async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/auth/refresh') return json(401)
    if (url === '/api/auth/login') return json(200, session)
    if (url === '/api/trips') return json(200, [])
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetch)
  render(<App />)

  await userEvent.type(await screen.findByLabelText('Email'), 'win@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('heading', { name: 'My Trips' })).toBeInTheDocument()
  expect(screen.getByText('Hi Win, where to next?')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
})

it('registers and shows server errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/register') return json(409, { detail: 'Email already registered' })
    return json(401)
  }))
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: 'Create an account' }))
  await userEvent.type(screen.getByLabelText('Your name'), 'Win')
  await userEvent.type(screen.getByLabelText('Email'), 'win@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'long-enough-pw')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
})
