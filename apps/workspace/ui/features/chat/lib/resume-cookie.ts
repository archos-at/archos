import { resumesUntil, type ArrivalState } from './resume-session'

export const CHAT_RESUME_COOKIE_PREFIX = 'chat_resume.'
const PERSONAL_SIDE = 'personal'
const SIDE_ID = /^[\w-]{1,64}$/
const A_YEAR_S = 60 * 60 * 24 * 365

export function chatResumeCookie(side: string | null): string | null {
  if (side === null) return `${CHAT_RESUME_COOKIE_PREFIX}${PERSONAL_SIDE}`
  return SIDE_ID.test(side) && side !== PERSONAL_SIDE ? `${CHAT_RESUME_COOKIE_PREFIX}${side}` : null
}

export function arrivalResumes(
  search: { session?: string | null; new?: string | null },
  sideCookieSet: boolean
): boolean {
  if (search.session) return true
  if (search.new) return false
  return sideCookieSet
}

export function resumeDeadlines(state: ArrivalState, now: number = Date.now()): Map<string, number> {
  const sides = new Set<string | null>()
  for (const conversation of state.conversations) {
    if (conversation.userId === state.currentUserId) sides.add(conversation.projectId ?? null)
  }
  if (state.currentConversation) sides.add(state.currentConversation.projectId ?? null)
  const deadlines = new Map<string, number>()
  for (const side of sides) {
    const name = chatResumeCookie(side)
    const until = resumesUntil(state, side, now)
    if (name && until !== null && until > now) deadlines.set(name, until)
  }
  return deadlines
}

export function resumeCookieWrites(
  written: ReadonlyMap<string, number>,
  wanted: ReadonlyMap<string, number>,
  now: number = Date.now()
): string[] {
  const writes: string[] = []
  for (const [name, until] of wanted) {
    if (written.get(name) === until) continue
    const maxAge = until === Number.POSITIVE_INFINITY ? A_YEAR_S : Math.ceil((until - now) / 1000)
    writes.push(`${name}=1; path=/app; max-age=${maxAge}; samesite=lax`)
  }
  for (const name of written.keys()) {
    if (!wanted.has(name)) writes.push(`${name}=; path=/app; max-age=0; samesite=lax`)
  }
  return writes
}

export function resumeCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(';')
    .map((part) => part.split('=')[0]!.trim())
    .filter((name) => name.startsWith(CHAT_RESUME_COOKIE_PREFIX))
}
