import type { JSX } from 'react'
import { FolderX, ScanSearch } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { hasPermission, ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { UploadScreeningCard } from '@/features/organization/components/upload-screening-card'
import { DeletedFolderContentCard } from '@/features/organization/components/deleted-folder-content-card'
import { getDeletedFolderContentPolicy } from '@/lib/organizations/deleted-folder-content'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'

export default async function OrganizationScreeningPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(organizationCopy)

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.screening.title')} subtitle={t('sections.screening.subtitle')} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="size-4 text-muted-foreground" aria-hidden />
              {t('screening.title')}
            </CardTitle>
            <CardDescription>{t('screening.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadScreeningCard canEdit={hasPermission(session, ORG_PERMISSIONS.settingsManage)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderX className="size-4 text-muted-foreground" aria-hidden />
              {t('deletedFolderContent.title')}
            </CardTitle>
            <CardDescription>{t('deletedFolderContent.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DeletedFolderContentCard
              canEdit={hasPermission(session, ORG_PERMISSIONS.settingsManage)}
              initial={await getDeletedFolderContentPolicy(session.organizationId)}
            />
          </CardContent>
        </Card>
      </div>
    )
  })
}
