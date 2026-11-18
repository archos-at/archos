import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { hasWrittenInOrganization } from '@/lib/conversations/repository'
import { getUserPreferences } from '@/lib/user-preferences/service'
import { NO_TOURS, tourEligibility, type TourEligibility } from './product-tour'

export async function resolveTourEligibility(session: AuthorizedSession): Promise<TourEligibility> {
  try {
    const prefs = await getUserPreferences(session)
    const unseen = tourEligibility(prefs, false)
    if (!unseen.welcome && !unseen.project) return NO_TOURS
    const hasWritten = await hasWrittenInOrganization(session.organizationId, session.userId)
    return tourEligibility(prefs, hasWritten)
  } catch {
    return NO_TOURS
  }
}
