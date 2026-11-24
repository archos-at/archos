import { NEW_PERSONAL_CHAT_HREF } from './rail-mode'
import { projectIdFromPathname } from './org-sections'

export const PROJECT_OVERVIEW_PATH = '/app/projects'
export const NEW_PROJECT_PATH = `${PROJECT_OVERVIEW_PATH}?new=1`
export const LAST_PLACE_COOKIE = 'last_place'

/** The one-shot ask `/app/projects` redirects with: `1` opens the project overview over the page, `new` with create open. */
export const OVERVIEW_PARAM = 'overview'

export function withOverview(path: string, create: boolean): string {
  const [bare, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.set(OVERVIEW_PARAM, create ? 'new' : '1')
  return `${bare}?${params.toString()}`
}
export const FIRST_PLACE = NEW_PERSONAL_CHAT_HREF

const NOT_A_PLACE = ['/app/onboarding', '/app/chat', PROJECT_OVERVIEW_PATH]

export function isPlace(path: string): boolean {
  if (!path.startsWith('/app/') || path.startsWith('//') || /[\\\s]/.test(path)) return false
  const bare = path.split(/[?#]/)[0]!
  return !NOT_A_PLACE.some((excluded) => bare === excluded || bare === `${excluded}/`) && !bare.startsWith('/app/onboarding/')
}

const PROJECT_ID = /^[\w-]{1,64}$/

export function landingPath(lastPlace: string | undefined): string {
  if (!lastPlace) return FIRST_PLACE
  const decoded = safeDecode(lastPlace)
  if (!decoded || !isPlace(decoded)) return FIRST_PLACE
  const projectId = projectIdFromPathname(decoded)
  return projectId && PROJECT_ID.test(projectId) ? `/app/projects/${projectId}/chat?new=1` : FIRST_PLACE
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
