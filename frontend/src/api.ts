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
  // A FormData body (a file upload) gets its multipart Content-Type, with the boundary, from the browser.
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers, credentials: 'same-origin' })
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, body?.detail ?? `Request failed (${res.status})`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const readXsrf = () => document.cookie.split('; ').find((c) => c.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length)

/**
 * The two calls that act on the session cookie alone (refresh, logout) must echo the CSRF token, which only this
 * site can read from its XSRF-TOKEN cookie. The first time, ask the server to set that cookie.
 */
async function csrfHeader(): Promise<Record<string, string>> {
  if (!readXsrf()) await fetch('/api/auth/csrf', { credentials: 'same-origin' }).catch(() => undefined)
  const token = readXsrf()
  return token ? { 'X-XSRF-TOKEN': decodeURIComponent(token) } : {}
}

/** Trades the HttpOnly refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= csrfHeader().then((headers) => send('/api/auth/refresh', { method: 'POST', headers }))
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

/** POSTs a multipart form, e.g. a file upload. */
export async function startSession(path: '/api/auth/login' | '/api/auth/register', body: unknown): Promise<User> {
  const s = await parse<Session>(await send(path, { method: 'POST', body: JSON.stringify(body) }))
  accessToken = s.accessToken
  return s.user
}

/** Forgets the access token even if the server can't be reached; the server ends the session when it can. */
export async function endSession(): Promise<void> {
  try {
    await send('/api/auth/logout', { method: 'POST', headers: await csrfHeader() })
  } finally {
    accessToken = null
  }
}

/** Permanently deletes the signed-in account (the password is checked again on the server). */
export async function deleteAccount(password: string): Promise<void> {
  await parse<void>(await send('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) }))
  accessToken = null
}

/**
 * Reads a server-sent-event stream with the bearer token (EventSource can't send headers or a body).
 * Calls onEvent(name, data) per event; resolves when the stream ends. A body makes it a POST (FormData as-is, for uploads).
 */
export async function readEvents(
  path: string, onEvent: (name: string, data: string) => void, signal: AbortSignal, body?: unknown,
): Promise<void> {
  const init: RequestInit = body === undefined ? { signal }
    : { signal, method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }
  let res = await send(path, init)
  if (res.status === 401 && (await refreshSession())) res = await send(path, init)
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null)
    throw new ApiError(res.status, detail?.detail ?? 'The connection dropped. Try again.')
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    const events = buffer.split('\n\n')
    buffer = events.pop()!
    for (const e of events) {
      const lines = e.split('\n')
      const name = lines.find((l) => l.startsWith('event:'))?.slice(6).trim()
      const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
      if (name) onEvent(name, data)
    }
  }
}
