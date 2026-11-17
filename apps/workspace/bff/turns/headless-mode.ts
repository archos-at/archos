export const HEADLESS_MODE_HEADERS = { 'x-chat-mode': 'headless', 'x-aiq-mode': 'headless' } as const

export const TURN_DOOR_HEADER = 'x-turn-door'
export const TURN_SESSION_SOURCE_HEADER = 'x-turn-session-source'

export function turnDoorHeaders(origin: { door: string; sessionSource: string } | undefined): Record<string, string> {
  if (!origin) return {}
  return { [TURN_DOOR_HEADER]: origin.door, [TURN_SESSION_SOURCE_HEADER]: origin.sessionSource }
}
