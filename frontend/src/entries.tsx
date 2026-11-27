import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from './api'
import { Modal } from './dialogs'
import { KIND, canEdit, entrySummary } from './trip'
import type { Entry, Trip } from './types'

/** A day's flights, lodging, meal slots, notes and open choices. No map pin, not part of reordering. */
export function EntryList({ trip, entries, date }: { trip: Trip; entries: Entry[]; date: string | null }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Entry | null>(null)
  const editable = canEdit(trip)
  const choose = useMutation({
    mutationFn: ({ id, option }: { id: string; option: number }) =>
      api(`/api/trips/${trip.id}/entries/${id}/choose`, { method: 'POST', body: { option } }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['entries', trip.id] })
      qc.invalidateQueries({ queryKey: ['destinations', trip.id] })
    },
  })
  if (entries.length === 0) return null
  return (
    <>
      <ul aria-label="Plans and notes" style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((e) => {
          const [icon, label] = KIND[e.kind]
          const summary = entrySummary(e.kind, e.details, date)
          return (
            <li key={e.id} className="stop entry" data-kind={e.kind}>
              <span className="entry-icon" aria-hidden="true">{icon}</span>
              <span style={{ width: 52, flex: 'none', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{e.startTime?.slice(0, 5) ?? '—'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="sr-only">{label}: </span>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{e.title}</span>
                {summary && <span className="muted" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>{summary}</span>}
                {e.kind === 'CHOICE' && (
                  <div className="row" style={{ gap: 6, marginTop: 8 }} role="group" aria-label={`Options for ${e.title}`}>
                    {(e.details.options ?? []).map((o, i) => editable
                      ? <button key={i} className="btn btn-soft" aria-label={`Choose ${o.label}`} disabled={choose.isPending}
                          onClick={() => choose.mutate({ id: e.id, option: i })}>{o.label}</button>
                      : <span key={i} className="pill">{o.label}</span>)}
                  </div>
                )}
              </div>
              {editable && <button className="btn btn-soft" aria-label={`Edit ${e.title}`} onClick={() => setEditing(e)}>Edit</button>}
            </li>
          )
        })}
      </ul>
      {choose.error && <div role="alert" className="error" style={{ marginTop: 8 }}>{choose.error.message}</div>}
      {editing && <EditEntryDialog trip={trip} entry={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function EditEntryDialog({ trip, entry, onClose }: { trip: Trip; entry: Entry; onClose: () => void }) {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['entries', trip.id] })
    onClose()
  }
  const save = useMutation({
    mutationFn: (body: unknown) => api(`/api/trips/${trip.id}/entries/${entry.id}`, { method: 'PUT', body }),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/trips/${trip.id}/entries/${entry.id}?version=${entry.version}`, { method: 'DELETE' }),
    onSuccess: done,
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate({ version: entry.version, title: f.get('title'), dayIndex: entry.dayIndex, startTime: (f.get('startTime') as string) || null })
  }

  const error = save.error ?? remove.error
  return (
    <Modal title={`Edit ${KIND[entry.kind][1].toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">Title<input name="title" required maxLength={200} defaultValue={entry.title} /></label>
        <label className="field">Time<input name="startTime" type="time" defaultValue={entry.startTime?.slice(0, 5) ?? ''} /></label>
        {entry.source && <p className="muted" style={{ margin: 0, fontSize: 13 }}>From your plan: “{entry.source}”</p>}
        {error && <div role="alert" className="error">{error.message}</div>}
        <div className="spread">
          <button type="button" className="btn btn-ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</button>
          <button className="btn btn-primary" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  )
}
