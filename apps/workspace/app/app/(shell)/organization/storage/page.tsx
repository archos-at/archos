import type { JSX } from 'react'
import { HardDrive } from 'lucide-react'
import { withPageSession } from '@/lib/auth/require-auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { StorageUsageCard } from '../storage-usage-card'

export default async function OrganizationStoragePage(): Promise<JSX.Element> {
  return withPageSession(async () => {
    const t = await getTranslations(organizationCopy)

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.storage.title')} subtitle={t('sections.storage.subtitle')} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" aria-hidden />
              {t('storage.title')}
            </CardTitle>
            <CardDescription>{t('storage.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <StorageUsageCard />
          </CardContent>
        </Card>
      </div>
    )
  })
}
