import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { canViewDownloadLog } from '@/lib/authz/organizations'
import { listOrganizationMembers } from '@/lib/organizations/service'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { DownloadLogView, type DownloadLogPerson } from '@/features/organization/components/download-log-view'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'

export default async function OrganizationDownloadLogPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    if (!canViewDownloadLog(session)) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title={t('sections.downloads.title')} subtitle={t('sections.downloads.subtitle')} />
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

    let people: DownloadLogPerson[] = []
    try {
      people = await listOrganizationMembers(session.organizationId)
    } catch {
      people = []
    }

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.downloads.title')} subtitle={t('sections.downloads.subtitle')} />
        <DownloadLogView people={people} />
      </div>
    )
  })
}
