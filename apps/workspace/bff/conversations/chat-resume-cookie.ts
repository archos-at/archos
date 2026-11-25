export const CHAT_RESUME_COOKIE_PREFIX = 'chat_resume.'
const PERSONAL_SIDE = 'personal'
const SIDE_ID = /^[\w-]{1,64}$/

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
