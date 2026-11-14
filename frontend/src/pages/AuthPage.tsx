import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { Logo } from '../icons'
import { Scene } from '../landing/Scene'
import '../landing/landing.css'

export function AuthPage({ initialMode = 'login' }: { initialMode?: 'login' | 'register' }) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
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

  const isLogin = mode === 'login'
  return (
    <div className="auth">
      <main className="auth-form">
        <Link to="/" className="brand" style={{ marginBottom: 36 }}><Logo /> TravelPal</Link>
        <h1 style={{ fontSize: 36, fontWeight: 800 }}>{isLogin ? 'Welcome back' : "Let's plan something"}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 16 }}>
          {isLogin ? 'Your trips are right where you left them.' : 'Takes a minute. Bring your friends in later.'}
        </p>
        <form onSubmit={submit} className="card" style={{ marginTop: 28, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!isLogin && (
            <label className="field">Your name<input name="displayName" required maxLength={80} autoComplete="name" /></label>
          )}
          <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
          <label className="field">
            Password
            <input name="password" type="password" required minLength={isLogin ? 1 : 10} maxLength={128}
              autoComplete={isLogin ? 'current-password' : 'new-password'} aria-describedby={isLogin ? undefined : 'pw-hint'} />
          </label>
          {!isLogin && <span id="pw-hint" className="muted" style={{ fontSize: 12, marginTop: -10 }}>At least 10 characters.</span>}
          {error && <div role="alert" className="error">{error}</div>}
          <button className="btn btn-primary" style={{ minHeight: 50 }} disabled={busy}>{isLogin ? 'Log in' : 'Create account'}</button>
        </form>
        <p style={{ marginTop: 18, fontSize: 14 }}>
          {isLogin ? 'New here? ' : 'Have an account? '}
          <button className="btn-ghost" style={{ border: 0, background: 'none', color: 'var(--accent)', fontWeight: 700, padding: 0 }}
            onClick={() => { setMode(isLogin ? 'register' : 'login'); setError(null) }}>
            {isLogin ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </main>
      <aside className="auth-art" aria-hidden="true">
        <Scene />
        <div className="auth-quote">
          <b>Paste everyone's places.</b>
          <span>Get days that actually work.</span>
        </div>
      </aside>
    </div>
  )
}
