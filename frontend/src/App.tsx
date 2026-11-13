import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from './api'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { AuthPage } from './pages/AuthPage'
import { Dashboard } from './pages/Dashboard'
import { JoinPage } from './pages/JoinPage'
import { OptimizePage } from './pages/OptimizePage'
import { TripPage } from './pages/TripPage'

export function makeQueryClient() {
  const qc: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    // A 409 means someone else changed it first: show their version instead of keeping ours.
    mutationCache: new MutationCache({ onError: (e) => { if (e instanceof ApiError && e.status === 409) qc.invalidateQueries() } }),
  })
  return qc
}
const queryClient = makeQueryClient()

function Routed() {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <AuthPage />
  return (
    <Routes>
      <Route path="/trips/:tripId" element={<TripPage tab="main" />} />
      <Route path="/trips/:tripId/destinations" element={<TripPage tab="destinations" />} />
      <Route path="/trips/:tripId/members" element={<TripPage tab="members" />} />
      <Route path="/trips/:tripId/activity" element={<TripPage tab="activity" />} />
      <Route path="/trips/:tripId/suggestions" element={<TripPage tab="suggestions" />} />
      <Route path="/trips/:tripId/suggestions/:proposalId" element={<TripPage tab="suggestions" />} />
      <Route path="/trips/:tripId/optimize/:previewId" element={<OptimizePage />} />
      <Route path="/join/:token" element={<JoinPage />} />
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
