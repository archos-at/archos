/**
 * Profile / account settings.
 *
 * A single place to manage identity, appearance (theme), interface language,
 * and session/security. Account identity is read from the WorkOS session on
 * the server; the interactive preference controls render in a client island
 * ({@link ProfileControls}).
 */

import type { JSX } from 'react'
import { Building2, UserRound } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { BackLink, ShellContent } from '@/components/shell'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { SectionLabel } from '@/components/ui/section-label'
import { getTranslations } from '@/i18n/server'
import type { Translator } from '@/i18n'
import { profileCopy } from '@/i18n/namespaces/profile'
import { getOrgSettings, getOrganizationOverview } from '@/lib/organizations/service'
import { ProfileControls } from './profile-controls'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { postHogConfigFromEnv } from '@/lib/analytics/posthog-config'
import { ConnectAgentCard } from '@/features/agent-connect/components'
import { loadAgentConnectState } from '@/features/agent-connect/lib/connect-state'
import { CONNECT_AGENT_GUIDE_URL } from '@/features/agent-connect/lib/guide'
import { getReleaseNoticePreference } from '@/lib/release-notes/summary-notice'

const KNOWN_ROLE_SLUGS = new Set(['org-platform-owner', 'admin', 'member'])

/**
 * Turn an unknown WorkOS role slug into a readable label: drop an `org-`
 * prefix and title-case the words (`org-billing-admin` → `Billing Admin`).
 */
const humanizeRoleSlug = (slug: string): string =>
  slug
    .replace(/^org-/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || slug

/** Localized role label, falling back to a humanized slug for unknown roles. */
const roleLabel = (slug: string, t: Translator): string =>
  KNOWN_ROLE_SLUGS.has(slug) ? t(`account.roles.${slug}`) : humanizeRoleSlug(slug)

/**
 * Best-effort organization display name. Prefers the app-side display name,
 * falls back to the WorkOS org name, and finally the raw id — never throws, so
 * a lookup failure degrades gracefully instead of crashing the page.
 */
const resolveOrganizationName = async (organizationId: string): Promise<string> => {
  try {
    const settings = await getOrgSettings(organizationId)
    if (settings.displayName) return settings.displayName
  } catch {
    // Non-fatal — fall through to the WorkOS lookup.
  }
  try {
    const overview = await getOrganizationOverview(organizationId)
    if (overview.name) return overview.name
  } catch {
    // Non-fatal — fall through to the raw id.
  }
  return organizationId
}

export default async function ProfilePage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(profileCopy)

    // `process.env` whole, so Next does not inline the build-time value (layout.tsx).
    const posthog = postHogConfigFromEnv(process.env)
    const analyticsAvailable = Boolean(posthog.host && posthog.projectToken)

    const displayName = session.name || session.email || t('account.noName')
    const initial = String(displayName).charAt(0).toUpperCase()

    // The weekly notice's switch (ADR-0156, amendment). A failed read shows it on, the default.
    const releaseNoticeEnabled = session.organizationId
      ? await getReleaseNoticePreference(session).then(
          (preference) => preference.enabled,
          () => true,
        )
      : undefined

    const organizationName = session.organizationId
      ? await resolveOrganizationName(session.organizationId)
      : t('account.noOrganization')

    return (
      <ShellContent>
        <BackLink
          className="touch-target mb-6"
          fallbackHref="/app/projects"
          fallbackLabel={t('backToApp')}
        />

        <PageHeader className="mb-8" title={t('title')} subtitle={t('subtitle')} />

        <div className="animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-6 duration-base ease-entrance motion-reduce:animate-none">
          {/* Account */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="text-muted-foreground size-4" aria-hidden />
                {t('account.title')}
              </CardTitle>
              <CardDescription>{t('account.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar className="size-12">
                  {session.profilePictureUrl && (
                    <AvatarImage src={session.profilePictureUrl} alt="" />
                  )}
                  <AvatarFallback className="text-base font-medium">{initial}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-base font-medium">{displayName}</p>
                  {session.email && (
                    <p className="text-muted-foreground truncate text-sm">{session.email}</p>
                  )}
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <SectionLabel as="dt">
                    {t('account.name')}
                  </SectionLabel>
                  <dd className="mt-1 text-sm">{session.name || t('account.noName')}</dd>
                </div>
                <div>
                  <SectionLabel as="dt">
                    {t('account.email')}
                  </SectionLabel>
                  <dd className="mt-1 truncate text-sm">{session.email || t('account.noName')}</dd>
                </div>
                <div>
                  <SectionLabel as="dt">
                    {t('account.organization')}
                  </SectionLabel>
                  <dd className="mt-1 flex items-center gap-1.5 text-sm">
                    <Building2 className="text-muted-foreground size-3.5" aria-hidden />
                    <span className="truncate" title={session.organizationId ?? undefined}>
                      {organizationName}
                    </span>
                  </dd>
                </div>
                {session.role && (
                  <div>
                    <SectionLabel as="dt">
                      {t('account.role')}
                    </SectionLabel>
                    <dd className="mt-1 text-sm" title={session.role}>
                      {roleLabel(session.role, t)}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Only a person with an organization can connect an agent to it. */}
          {session.organizationId && (
            <ConnectAgentCard
              state={loadAgentConnectState(session)}
              guideHref={CONNECT_AGENT_GUIDE_URL}
            />
          )}

          <ProfileControls
            authRequired={isAuthRequired()}
            email={session.email}
            // The /app layout mounts the shortcuts for every session with an
            // organization, so the toggle shows exactly where they exist.
            shortcutsAvailable={Boolean(session.organizationId)}
            analyticsAvailable={analyticsAvailable}
            releaseNoticeEnabled={releaseNoticeEnabled}
          />
        </div>
      </ShellContent>
    )
  })
}
