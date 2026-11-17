import { chatEffortFromSettings } from '@/lib/reasoning-settings/catalog'
import type { JSX } from 'react'
import { Building2, FileDown, GraduationCap, Globe, Library, Mail, MessageSquareText, ShieldAlert, Users } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { isOrgAdmin } from '@/lib/authz/organizations'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import {
  getOrganizationOverview,
  getOrgSettings,
  type OrganizationOverview,
} from '@/lib/organizations/service'
import { getOrgInstructions } from '@/lib/org-instructions/service'
import { retentionDaysFromSettings } from '@/lib/download-log/kinds'
import { OfficeConventionsCard } from '@/features/organization/components/office-conventions-card'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DownloadLogRetentionForm } from '@/features/organization/components/download-log-retention-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { SectionLabel } from '@/components/ui/section-label'
import { getLocale, getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { OrgInstructionsForm } from './org-instructions-form'
import { OrgSettingsForm } from './org-settings-form'
import { HomeCountryNotice } from './home-country-notice'

export default async function OrganizationOverviewPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)
    const locale = await getLocale()

    const admin = isOrgAdmin(session)

    if (!admin) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader
            title={t('sections.overview.title')}
            subtitle={t('sections.overview.subtitle')}
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
                {t('notAdmin.title')}
              </CardTitle>
              <CardDescription>{t('notAdmin.description')}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      )
    }

    let overview: OrganizationOverview | null = null
    try {
      overview = await getOrganizationOverview(session.organizationId)
    } catch {
      overview = null
    }
    let settings: Awaited<ReturnType<typeof getOrgSettings>> | null = null
    let settingsError = false
    try {
      settings = await getOrgSettings(session.organizationId)
    } catch {
      settingsError = true
    }
    let instructions: Awaited<ReturnType<typeof getOrgInstructions>> | null = null
    let instructionsError = false
    try {
      instructions = await getOrgInstructions(session.organizationId)
    } catch {
      instructionsError = true
    }

    const createdLabel = overview
      ? new Date(overview.createdAt).toLocaleDateString(locale, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.overview.title')} subtitle={t('sections.overview.subtitle')} />
        {settings && !settings.homeCountry && <HomeCountryNotice />}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" aria-hidden />
              {t('overview.title')}
            </CardTitle>
            <CardDescription>{t('overview.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt>
                  <SectionLabel>{t('overview.name')}</SectionLabel>
                </dt>
                <dd className="mt-1 text-sm">{settings?.displayName || overview?.name || '—'}</dd>
              </div>
              <div>
                <dt>
                  <SectionLabel>{t('overview.id')}</SectionLabel>
                </dt>
                <dd className="mt-1 truncate font-mono text-sm" title={session.organizationId}>
                  {session.organizationId}
                </dd>
              </div>
              <div>
                <dt>
                  <SectionLabel>{t('overview.members')}</SectionLabel>
                </dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm">
                  <Users className="size-3.5 text-muted-foreground" aria-hidden />
                  {overview
                    ? overview.memberCountCapped
                      ? t('overview.membersCapped', { count: overview.memberCount })
                      : overview.memberCount
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>
                  <SectionLabel>{t('overview.pendingInvites')}</SectionLabel>
                </dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm">
                  <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                  {overview ? overview.pendingInviteCount : '—'}
                </dd>
              </div>
              <div>
                <dt>
                  <SectionLabel>{t('overview.domains')}</SectionLabel>
                </dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm">
                  <Globe className="size-3.5 text-muted-foreground" aria-hidden />
                  {overview && overview.domains.length > 0
                    ? overview.domains.join(', ')
                    : t('overview.noDomains')}
                </dd>
              </div>
              {settings?.homeCountry && (
                <div>
                  <dt>
                    <SectionLabel>{t('overview.homeCountry')}</SectionLabel>
                  </dt>
                  <dd className="mt-1 text-sm">{settings.homeCountry}</dd>
                </div>
              )}
              {createdLabel && (
                <div>
                  <dt>
                    <SectionLabel>{t('overview.created')}</SectionLabel>
                  </dt>
                  <dd className="mt-1 text-sm">{createdLabel}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {(settings || settingsError) && (
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.title')}</CardTitle>
              <CardDescription>{t('settings.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {settings ? (
                <OrgSettingsForm
                  initialDisplayName={settings.displayName}
                  initialDefaultLocale={settings.defaultLocale}
                  initialWebSearchEnabled={settings.settings.webSearchEnabled !== false}
                  initialChatEffort={chatEffortFromSettings(settings.settings)}
                />
              ) : (
                <EmptyState variant="bare" title={t('settings.loadError')} />
              )}
            </CardContent>
          </Card>
        )}
        {settings && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileDown className="size-4 text-muted-foreground" aria-hidden />
                {t('downloadLog.retentionCard.title')}
              </CardTitle>
              <CardDescription>{t('downloadLog.retentionCard.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <DownloadLogRetentionForm initialDays={retentionDaysFromSettings(settings.settings)} />
            </CardContent>
          </Card>
        )}
        {(instructions || instructionsError) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />
                {t('instructions.title')}
              </CardTitle>
              <CardDescription>{t('instructions.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {instructions ? (
                <OrgInstructionsForm initialInstructions={instructions.instructions} />
              ) : (
                <EmptyState variant="bare" title={t('instructions.loadError')} />
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="size-4 text-muted-foreground" aria-hidden />
              {t('officeConventions.title')}
            </CardTitle>
            <CardDescription>{t('officeConventions.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <OfficeConventionsCard />
          </CardContent>
        </Card>
        {/* Only for an office with its own standards (`office-standards`). */}
        {isOfficeStandardsEnabled(session) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Library className="size-4 text-muted-foreground" aria-hidden />
                {t('baseKnowledge.title')}
              </CardTitle>
              <CardDescription>{t('baseKnowledge.description')}</CardDescription>
            </CardHeader>
            {/* The standards have a place of their own now, beside the Büroablage;
                a settings card was where nobody looked for documents. */}
            <CardContent>
              <Button asChild variant="secondary" size="sm">
                <Link href="/app/base-knowledge">{t('baseKnowledge.open')}</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    )
  })
}
