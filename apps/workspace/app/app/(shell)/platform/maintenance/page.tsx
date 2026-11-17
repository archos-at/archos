import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { BaseKnowledge } from '../base-knowledge'
import { RunKillSwitch } from '../run-kill-switch'
import { VectorMaintenance } from '../vector-maintenance'

export default async function PlatformMaintenancePage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.maintenance.title')} subtitle={t('sections.maintenance.subtitle')} />
      <BaseKnowledge />
      <VectorMaintenance />
      <RunKillSwitch />
    </div>
  )
}
