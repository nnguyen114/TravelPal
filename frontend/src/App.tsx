import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { AuthPage } from './pages/AuthPage'
import { Dashboard } from './pages/Dashboard'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

function Routed() {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <AuthPage />
  return (
    <Routes>
      <Route path="*" element={<Dashboard />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routed />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
