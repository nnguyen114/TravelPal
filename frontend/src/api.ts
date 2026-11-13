export type User = { id: string; email: string; displayName: string }
type Session = { accessToken: string; user: User }

let accessToken: string | null = null
let refreshing: Promise<Session | null> | null = null

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers, credentials: 'same-origin' })
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, body?.detail ?? `Request failed (${res.status})`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Trades the HttpOnly refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= send('/api/auth/refresh', { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) {
        accessToken = null
        return null
      }
      const s = (await res.json()) as Session
      accessToken = s.accessToken
      return s
    })
    .finally(() => (refreshing = null))
  return refreshing
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const req = { method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.stringify(init.body) }
  let res = await send(path, req)
  if (res.status === 401 && accessToken && (await refreshSession())) {
    res = await send(path, req)
  }
  return parse<T>(res)
}

export async function startSession(path: '/api/auth/login' | '/api/auth/register', body: unknown): Promise<User> {
  const s = await parse<Session>(await send(path, { method: 'POST', body: JSON.stringify(body) }))
  accessToken = s.accessToken
  return s.user
}

export async function endSession(): Promise<void> {
  await send('/api/auth/logout', { method: 'POST' })
  accessToken = null
}
