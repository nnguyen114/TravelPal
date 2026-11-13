import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { endSession, refreshSession, startSession, type User } from './api'

type AuthState = {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    refreshSession().then((s) => {
      setUser(s?.user ?? null)
      setReady(true)
    })
  }, [])

  const value: AuthState = {
    user,
    ready,
    login: async (email, password) => setUser(await startSession('/api/auth/login', { email, password })),
    register: async (email, password, displayName) =>
      setUser(await startSession('/api/auth/register', { email, password, displayName })),
    logout: async () => {
      await endSession()
      setUser(null)
    },
  }
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
