import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import { isLocale } from '@/i18n/config'
import { findOrganization } from '@/lib/organizations/repository'
import { findUserPreferences } from '@/lib/user-preferences/repository'
import type { MailThreadLocale } from './mail-thread-vocabulary'

export async function newThreadLocaleFor(session: AuthorizedSession): Promise<MailThreadLocale> {
  const preferences = await findUserPreferences(session.userId, session.organizationId).catch(() => null)
  if (isLocale(preferences?.locale)) return preferences.locale
  const organization = await findOrganization(session.organizationId).catch(() => null)
  return isLocale(organization?.defaultLocale) ? organization.defaultLocale : 'de'
}
