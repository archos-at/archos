/**
 * Grundlagen des Büros, presented as a page sheet (ADR-0024, ADR-0163): the
 * office's standards, commentaries and directives as a place of their own,
 * beside the Büroablage they are filed in.
 *
 * One component behind both arrivals, as the Büroablage's: the intercepted
 * overlay (`(shell)/@overlay/(.)base-knowledge`) and the real
 * `/app/base-knowledge` page. Any member reads; uploading, confirming, checking
 * and removing take `org:office_shelf:manage`, decided by each route.
 */

import type { JSX } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { PageSheetClose } from '@/components/ui/page-sheet'
import { RoutePageSheet } from '@/components/shell/route-page-sheet'
import { BaseKnowledgeWorkspace } from '@/features/base-knowledge'

export async function BaseKnowledgeSheet({
  standalone,
}: {
  standalone: boolean
}): Promise<JSX.Element> {
  return withPageSession(async () => {
    const t = await getTranslations(baseKnowledgeCopy)
    const tCommon = await getTranslations(commonCopy)
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
        />
      </RoutePageSheet>
    )
  })
}
