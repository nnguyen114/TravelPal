import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Routes } from 'react-router'
import { vi } from 'vitest'
import { AuthProvider } from './auth'
import type { Destination, Entry, Trip } from './types'

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Handler = (body: unknown, url: string) => Response
/** Routes "METHOD /path" to handlers; records every call. Unknown routes 404. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const path = url.split('?')[0]
    if (path === '/api/auth/refresh') {
      return json(200, { accessToken: 't', user: { id: 'u1', email: 'w@x.y', displayName: 'Win' } })
    }
    const h = routes[`${method} ${path}`]
    return h ? h(body, url) : json(404, { detail: 'not found' })
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

/** path may carry navigation state, e.g. { pathname: '/trips/t1', state: { imported } }. */
export function renderAt(path: string | { pathname: string; state: unknown }, routes: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{routes}</Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

export const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 't1', name: 'Japan 2027', startDate: '2027-06-10', endDate: '2027-06-12', version: 0, dayCount: 3, role: 'OWNER',
  cities: [{ id: 'c1', name: 'Tokyo', lat: 35.68, lng: 139.76, startDate: null, endDate: null, locked: false }],
  members: [{ userId: 'u1', displayName: 'Win', role: 'OWNER' }, { userId: 'u2', displayName: 'Mina', role: 'EDITOR' },
    { userId: 'u3', displayName: 'Kenji', role: 'VIEWER' }, { userId: 'u4', displayName: 'Lee', role: 'VIEWER' }],
  ...over,
})

export const dest = (id: string, dayIndex: number | null, position: number | null, over: Partial<Destination> = {}): Destination => ({
  id, name: id, address: 'Harajuku, Tokyo', lat: 35.6, lng: 139.7, providerId: null, notes: null, durationMin: 90,
  dayIndex, position, startTime: dayIndex === null ? null : '09:00:00', locked: false, flexibility: 'FLEXIBLE', version: 0,
  visitAfter: null, visitBefore: null, dayTrip: false, hintsSource: null, ...over,
})

export const entry = (id: string, dayIndex: number | null, over: Partial<Entry> = {}): Entry => ({
  id, dayIndex, position: 0, kind: 'NOTE', title: id, startTime: null, details: {}, source: null, version: 0, ...over,
})
