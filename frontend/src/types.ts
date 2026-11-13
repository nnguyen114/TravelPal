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
}
/** POST omits version; PUT must send the version the editor saw. */
export type DestinationInput = Omit<Destination, 'id' | 'position' | 'version'> & { version?: number }
export type HistoryEntry = {
  id: number; actorId: string | null; actorName: string | null; type: string; summary: string; createdAt: string
  undoable: boolean; undone: boolean
}
export type InvitePreview = { tripId: string; name: string; startDate: string; endDate: string; cities: string[]; memberCount: number; member: boolean }
export type Place = { name: string; address: string; lat: number; lng: number; providerId: string }
