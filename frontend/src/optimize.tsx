import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from './api'
import type { Mode, Preview } from './types'

type OptimizeInput = {
  mode: Mode; scope: 'TRIP' | 'DAY' | 'SELECTION'; dayIndex?: number | null; destinationIds?: string[]; instructions?: string | null
}

/** Starts an optimizer run and opens its preview. Nothing changes until the preview is applied. */
export function useOptimize(tripId: string, replace = false) {
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (body: OptimizeInput) => api<Preview>(`/api/trips/${tripId}/optimize`, { method: 'POST', body }),
    onSuccess: (p) => navigate(`/trips/${tripId}/optimize/${p.id}`, { replace }),
  })
}

const MODES: [Mode, string][] = [['RELAXED', 'Relaxed'], ['BALANCED', 'Balanced'], ['PACKED', 'Packed']]

export function PaceSwitch({ value, onChange, disabled }: { value: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  return (
    <div className="segmented" role="group" aria-label="Pace">
      {MODES.map(([m, label]) => (
        <button key={m} aria-pressed={value === m} disabled={disabled} onClick={() => onChange(m)}>{label}</button>
      ))}
    </div>
  )
}
