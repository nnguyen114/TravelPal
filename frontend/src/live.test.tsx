import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, readEvents } from './api'
import { makeQueryClient } from './App'
import { useTripLive } from './live'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function sse(...chunks: string[]) {
  const body = new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x)))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

it('parses named events split across chunks and ignores comments', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse(':connected\n\nevent:chan', 'ged\ndata:{}\n\n:ping\n\nevent:changed\ndata:{}\n\n')))
  const seen: string[] = []
  await readEvents('/s', (n) => seen.push(n), new AbortController().signal)
  expect(seen).toEqual(['changed', 'changed'])
})

it('fails when the stream is refused', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
  await expect(readEvents('/s', () => {}, new AbortController().signal)).rejects.toBeInstanceOf(ApiError)
})

it('refetches the trip when a collaborator changes it, and reconnects after drops', async () => {
  const fetch = vi.fn().mockImplementation(async () => sse('event:changed\ndata:{}\n\n'))
  vi.stubGlobal('fetch', fetch)
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  function Probe() {
    useTripLive('t1')
    return null
  }
  const { unmount } = render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>)
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['destinations', 't1'] }))
  expect(fetch.mock.calls[0][0]).toBe('/api/trips/t1/stream')
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 4000 })
  unmount()
})

it('a 409 on any mutation refetches everything', async () => {
  const qc = makeQueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  await qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject(new ApiError(409, 'stale')) }).execute(undefined).catch(() => {})
  expect(spy).toHaveBeenCalled()
  spy.mockClear()
  await qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject(new ApiError(400, 'bad')) }).execute(undefined).catch(() => {})
  expect(spy).not.toHaveBeenCalled()
})
