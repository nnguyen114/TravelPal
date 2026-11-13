import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { readEvents } from './api'

export const RECONNECT_MS = 3000

/** Keeps a trip's queries fresh: any collaborator's change makes everyone refetch the shared state. */
export function useTripLive(tripId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!tripId) return
    const ctrl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['trip', tripId] })
      qc.invalidateQueries({ queryKey: ['destinations', tripId] })
      qc.invalidateQueries({ queryKey: ['events', tripId] })
    }
    const connect = () =>
      readEvents(`/api/trips/${tripId}/stream`, (name) => name === 'changed' && refresh(), ctrl.signal)
        .catch(() => undefined)
        .finally(() => {
          // Reconnect after drops; refetch once in case we missed changes meanwhile.
          if (!ctrl.signal.aborted) timer = setTimeout(() => { refresh(); connect() }, RECONNECT_MS)
        })
    connect()
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [tripId, qc])
}
