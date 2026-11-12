/**
 * Route-level loading state for the hard-load page of the office standards.
 *
 * Sheet-shaped, as the Büroablage's, so the skeleton and the surface replacing
 * it are the same box; soft navigations render the intercepted overlay instead,
 * which has its own loading file.
 */

import type { JSX } from 'react'
import { PageSheetSkeleton } from '@/components/shell/page-sheet-skeleton'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'

export default async function BaseKnowledgeLoading(): Promise<JSX.Element> {
  const t = await getTranslations(commonCopy)
  return <PageSheetSkeleton loadingLabel={t('states.loading')} />
}
