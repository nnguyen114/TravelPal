export type Role = 'OWNER' | 'EDITOR' | 'VIEWER'
export type City = { id: string; name: string; lat: number | null; lng: number | null; startDate: string | null; endDate: string | null; locked: boolean }
export type Member = { userId: string; displayName: string; role: Role }
export type TripSummary = { id: string; name: string; startDate: string; endDate: string; role: Role; memberCount: number; cities: string[] }
export type Trip = {
  id: string; name: string; startDate: string; endDate: string; version: number; dayCount: number; role: Role
  cities: City[]; members: Member[]
}
export type Flexibility = 'FIXED' | 'PREFERRED' | 'FLEXIBLE'
export type Destination = {
  id: string; name: string; address: string | null; lat: number | null; lng: number | null; providerId: string | null
  notes: string | null; durationMin: number | null; dayIndex: number | null; position: number | null
  startTime: string | null; locked: boolean; flexibility: Flexibility; version: number
  visitAfter: string | null; visitBefore: string | null; dayTrip: boolean; hintsSource: 'AI' | 'USER' | null
}
/** POST omits version; PUT must send the version the editor saw. */
export type DestinationInput = Omit<Destination, 'id' | 'position' | 'version' | 'hintsSource' | 'visitAfter' | 'visitBefore' | 'dayTrip'>
  & { version?: number; visitAfter?: string | null; visitBefore?: string | null; dayTrip?: boolean }
export type HistoryEntry = {
  id: number; actorId: string | null; actorName: string | null; type: string; summary: string; createdAt: string
  undoable: boolean; undone: boolean
}
export type InvitePreview = { tripId: string; name: string; startDate: string; endDate: string; cities: string[]; memberCount: number; member: boolean }
export type Place = { name: string; address: string; lat: number; lng: number; providerId: string }

export type Mode = 'RELAXED' | 'BALANCED' | 'PACKED'
export type PlanItem = { id: string; dayIndex: number | null; position: number | null; startTime: string | null }
export type PlanResult = {
  items: PlanItem[]; moved: string[]; added: string[]; unscheduled: string[]; keptLocked: string[]
  needsReview: { id: string; reason: string }[]; scheduled: number; total: number
  explanation: string; notes: { kind: 'suggestion' | 'verified' | 'unsure'; text: string }[]
}
export type Preview = {
  id: string; status: 'PENDING' | 'READY' | 'FAILED' | 'APPLIED' | 'DISCARDED'; stale: boolean
  request: { mode: Mode; scope: 'TRIP' | 'DAY' | 'SELECTION'; dayIndex: number | null; destinationIds?: string[]; instructions: string | null }
  result: PlanResult | null; error: string | null; createdAt: string
}

export type ProposalChange = {
  kind: 'ADD' | 'MOVE' | 'REMOVE'; destinationId: string | null; name: string
  fromDay: number | null; dayIndex: number | null; startTime: string | null
}
export type Impact = { fits: string; conflicts: string; dayEffect: string; suggestedDay?: number | null; basis?: string }
export type ProposalComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string }
export type Proposal = {
  id: string; title: string; description: string | null; status: 'OPEN' | 'MERGED' | 'CLOSED'
  authorId: string; authorName: string; createdAt: string; closedAt: string | null
  changes: ProposalChange[]; affectedDays: number[]; commentCount: number; stale: boolean
  impact: Impact | null; impactByName: string | null; comments: ProposalComment[] | null
}
export type Suggestion = {
  name: string; address: string; lat: number; lng: number; providerId: string; category: string; why: string; distanceKm: number
}
export type DiscoverResult = { vibe: string; suggestions: Suggestion[]; note: string }
export type LinkResult = { readable: boolean; guess: string | null; candidates: Place[]; message: string | null }
