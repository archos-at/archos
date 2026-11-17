import type { JSX } from 'react'
import { PageSheetSkeleton } from '@/components/shell/page-sheet-skeleton'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'

export default async function BaseKnowledgeOverlayLoading(): Promise<JSX.Element> {
  const t = await getTranslations(commonCopy)
  return <PageSheetSkeleton loadingLabel={t('states.loading')} />
}
