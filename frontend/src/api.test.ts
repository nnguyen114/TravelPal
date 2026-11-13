import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, endSession, refreshSession, startSession } from './api'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const session = (token: string) => ({ accessToken: token, user: { id: '1', email: 'a@b.c', displayName: 'A' } })

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('sends the bearer token and retries once after refreshing an expired one', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(200, session('t1')))
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, session('t2')))
      .mockResolvedValueOnce(json(200, [{ id: 'trip' }]))
    vi.stubGlobal('fetch', fetch)

    await startSession('/api/auth/login', { email: 'a', password: 'b' })
    expect(await api('/api/trips')).toEqual([{ id: 'trip' }])
    expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer t1')
    expect(fetch.mock.calls[2][0]).toBe('/api/auth/refresh')
    expect(fetch.mock.calls[3][1].headers.get('Authorization')).toBe('Bearer t2')
  })

  it('surfaces problem-detail messages and handles 204', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(400, { detail: 'End date is before start date' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('not json', { status: 500 })))
    await expect(api('/api/trips', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 400, message: 'End date is before start date' })
    expect(await api('/api/trips/1', { method: 'DELETE' })).toBeUndefined()
    await expect(api('/api/x')).rejects.toBeInstanceOf(ApiError)
  })

  it('shares one refresh between concurrent callers and clears the token when it fails', async () => {
    const fetch = vi.fn().mockResolvedValue(json(401))
    vi.stubGlobal('fetch', fetch)
    const [a, b] = await Promise.all([refreshSession(), refreshSession()])
    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('logout calls the server', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await endSession()
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/logout')
  })
})
