import type { JSX } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import { PageHeader } from '@/components/ui/page-header'
import { QuarantineQueue } from '@/features/organization/components/quarantine-queue'
import { getTranslations } from '@/i18n/server'
import { organizationCopy } from '@/i18n/namespaces/organization'

export default async function OrganizationQuarantinePage(): Promise<JSX.Element> {
  return withPageSession(async () => {
    const t = await getTranslations(organizationCopy)

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.quarantine.title')} subtitle={t('sections.quarantine.subtitle')} />
        <QuarantineQueue />
      </div>
    )
  })
}
