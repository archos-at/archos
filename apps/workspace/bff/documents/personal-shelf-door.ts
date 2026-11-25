import 'server-only'
import { actingDoor, currentActingSession } from '@/lib/agent-api/acting-session'
import type { CallDoor } from '@/lib/agent-api/call-door'
import { NotFoundError } from '@/lib/api/errors'

export const PERSONAL_SHELF_DOORS: ReadonlySet<CallDoor> = new Set<CallDoor>(['mcp'])

const admittedTurns = new WeakSet<object>()

export function admitPersonalShelfForTurn(session: { pinnedForTurn?: true }): void {
  if (session.pinnedForTurn) admittedTurns.add(session)
}

export function mayReachPersonalShelf(session: { pinnedForTurn?: true }): boolean {
  if (session.pinnedForTurn) return admittedTurns.has(session)
  if (currentActingSession() === undefined) return true
  const acting = actingDoor()
  return acting !== undefined && PERSONAL_SHELF_DOORS.has(acting.door)
}

export function requirePersonalShelfDoor(session: { pinnedForTurn?: true }): void {
  if (!mayReachPersonalShelf(session)) throw new NotFoundError()
}
