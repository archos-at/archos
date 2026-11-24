import { NEW_PERSONAL_CHAT_HREF } from './rail-mode'

export const PROJECT_OVERVIEW_PATH = '/app/projects'
export const NEW_PROJECT_PATH = `${PROJECT_OVERVIEW_PATH}?new=1`
export const LAST_PLACE_COOKIE = 'last_place'
export const FIRST_PLACE = NEW_PERSONAL_CHAT_HREF

const NOT_A_PLACE = ['/app/onboarding', '/app/chat', PROJECT_OVERVIEW_PATH]

export function isPlace(path: string): boolean {
  if (!path.startsWith('/app/') || path.startsWith('//') || /[\\\s]/.test(path)) return false
  const bare = path.split(/[?#]/)[0]!
  return !NOT_A_PLACE.some((excluded) => bare === excluded || bare === `${excluded}/`) && !bare.startsWith('/app/onboarding/')
}

export function landingPath(lastPlace: string | undefined): string {
  if (!lastPlace) return FIRST_PLACE
  const decoded = safeDecode(lastPlace)
  return decoded && isPlace(decoded) ? decoded : FIRST_PLACE
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
