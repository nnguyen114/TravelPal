import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { Logo } from '../icons'

export function AuthPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email'))
    const password = String(f.get('password'))
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password, String(f.get('displayName')))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" style={{ maxWidth: 440, paddingTop: 80 }}>
      <div className="brand" style={{ marginBottom: 28 }}><Logo /> TravelPal</div>
      <h1 style={{ fontSize: 32, fontWeight: 800 }}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="muted" style={{ marginTop: 6 }}>Plan trips together. Let AI sort out the days.</p>
      <form onSubmit={submit} className="card" style={{ marginTop: 24, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {mode === 'register' && (
          <label className="field">Your name<input name="displayName" required maxLength={80} autoComplete="name" /></label>
        )}
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">
          Password
          <input name="password" type="password" required minLength={mode === 'register' ? 10 : 1} maxLength={128}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {error && <div role="alert" className="error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      </form>
      <p style={{ marginTop: 16, fontSize: 14 }}>
        {mode === 'login' ? 'New here? ' : 'Have an account? '}
        <button className="btn-ghost" style={{ border: 0, background: 'none', color: 'var(--accent)', fontWeight: 700, padding: 0 }}
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}>
          {mode === 'login' ? 'Create an account' : 'Log in'}
        </button>
      </p>
    </main>
  )
}
