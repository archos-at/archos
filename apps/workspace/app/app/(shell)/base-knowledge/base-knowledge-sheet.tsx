import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { PageSheetClose } from '@/components/ui/page-sheet'
import { RoutePageSheet } from '@/components/shell/route-page-sheet'
import { BaseKnowledgeWorkspace } from '@/features/base-knowledge'
import { OfficeShelfPlaces } from '@/features/documents'

export async function BaseKnowledgeSheet({
  standalone,
}: {
  standalone: boolean
}): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    if (!isOfficeStandardsEnabled(session)) notFound()
    const t = await getTranslations(baseKnowledgeCopy)
    const tCommon = await getTranslations(commonCopy)
    const tShelf = await getTranslations(officeShelfCopy)
    return (
      <RoutePageSheet
        title={t('title')}
        subtitle={t('subtitle')}
        closeLabel={tCommon('actions.close')}
        headerless
        standalone={standalone}
      >
        <BaseKnowledgeWorkspace
          trailingActions={<PageSheetClose label={tCommon('actions.close')} />}
          place={{ title: tShelf('title'), crumb: session.organizationName, places: <OfficeShelfPlaces /> }}
          uploadCollection={officeShelfCollectionName(session.organizationId)}
        />
      </RoutePageSheet>
    )
  })
}
