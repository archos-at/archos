import { withLegacyHeaderNames } from '@/lib/http/legacy-header-names'

export const HEADLESS_MODE_HEADERS = withLegacyHeaderNames({ 'x-chat-mode': 'headless' })

export const TURN_DOOR_HEADER = 'x-turn-door'
export const TURN_SESSION_SOURCE_HEADER = 'x-turn-session-source'

export function turnDoorHeaders(origin: { door: string; sessionSource: string } | undefined): Record<string, string> {
  if (!origin) return {}
  return { [TURN_DOOR_HEADER]: origin.door, [TURN_SESSION_SOURCE_HEADER]: origin.sessionSource }
}
