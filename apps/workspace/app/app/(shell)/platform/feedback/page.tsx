import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { withPageSession } from '@/lib/auth/require-auth'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { hasPlatformPermission } from '@/lib/authz/platform'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { FeedbackTriage } from '@/features/product-feedback/components/feedback-triage'

export default async function PlatformFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string | string[]; claim?: string | string[] }>
}): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)
  const { report, claim } = await searchParams
  const canTriage = await withPageSession((session) =>
    hasPlatformPermission(session, PLATFORM_PERMISSIONS.settingsManage)
  )
  const focusReportId = typeof report === 'string' ? report : null
  const claimTicketId = typeof claim === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(claim) ? claim : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.feedback.title')} subtitle={t('sections.feedback.subtitle')} />
      <FeedbackTriage canTriage={canTriage} focusReportId={focusReportId} claimTicketId={claimTicketId} />
    </div>
  )
}
