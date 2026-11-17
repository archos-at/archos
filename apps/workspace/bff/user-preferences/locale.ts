import 'server-only'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { isLocale } from '@/i18n/config'
import type { SavedLocale } from '@/i18n/request-locale'
import { findOrganization } from '@/lib/organizations/repository'
import { findUserPreferences } from './repository'

const UNKNOWN: SavedLocale = { known: false }

export async function findSavedLocale(): Promise<SavedLocale> {
  try {
    const auth = await withAuth()
    const userId = auth.user?.id
    const organizationId = auth.organizationId
    if (!userId || !organizationId) return UNKNOWN

    const prefs = await findUserPreferences(userId, organizationId)
    if (isLocale(prefs?.locale)) return { known: true, locale: prefs.locale }

    const organization = await findOrganization(organizationId)
    return { known: true, locale: isLocale(organization?.defaultLocale) ? organization.defaultLocale : null }
  } catch {
    return UNKNOWN
  }
}
