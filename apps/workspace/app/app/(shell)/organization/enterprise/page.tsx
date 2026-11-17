import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { isOrgAdmin } from '@/lib/authz/organizations'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { OrgWidgets } from '../org-widgets'
import { OrgReingestFailedCard } from '../org-reingest-failed-card'

export default async function OrganizationEnterprisePage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    const admin = isOrgAdmin(session)
    const perms = session.permissions

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('sections.enterprise.title')}
          subtitle={t('sections.enterprise.subtitle')}
        />

        {admin ? (
          <>
            <OrgWidgets
              canManageUsers={false}
              canManageSso={perms.includes('widgets:sso:manage')}
              canManageDirectory={perms.includes('widgets:dsync:manage')}
              canManageDomains={perms.includes('widgets:domain-verification:manage')}
              canManageAuditLogs={perms.includes('widgets:audit-log-streaming:manage')}
            />
            <OrgReingestFailedCard />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
                {t('notAdmin.title')}
              </CardTitle>
              <CardDescription>{t('notAdmin.description')}</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    )
  })
}
