import type { JSX } from 'react'
import { ScrollText, ShieldAlert } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { canViewAuditLogs } from '@/lib/authz/organizations'
import { AuditLogButton } from '@/components/audit/audit-log-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'

export default async function OrganizationCompliancePage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    const canRead = canViewAuditLogs(session)

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('sections.compliance.title')}
          subtitle={t('sections.compliance.subtitle')}
        />

        {canRead ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScrollText className="size-4 text-muted-foreground" aria-hidden />
                {t('audit.title')}
              </CardTitle>
              <CardDescription>{t('audit.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <AuditLogButton
                endpoint="/api/organization/audit-portal"
                label={t('audit.open')}
                errorMessage={t('audit.error')}
              />
            </CardContent>
          </Card>
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
