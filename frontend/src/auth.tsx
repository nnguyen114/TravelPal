import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deleteAccount, endSession, refreshSession, startSession, type User } from './api'

type AuthState = {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()
  // Nothing from the previous account may stay on screen or in the cache for whoever signs in next.
  const signedOut = () => {
    qc.clear()
    setUser(null)
  }

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
      try {
        await endSession()
      } finally {
        signedOut()
      }
    },
    deleteAccount: async (password) => {
      await deleteAccount(password)
      signedOut()
    },
  }
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
