import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { AuthPage } from './pages/AuthPage'
import { Dashboard } from './pages/Dashboard'
import { TripPage } from './pages/TripPage'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

function Routed() {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <AuthPage />
  return (
    <Routes>
      <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
      <Route path="/trips/:tripId/destinations" element={<TripPage tab="destinations" />} />
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
