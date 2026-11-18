'use client'

import type { JSX } from 'react'
import { FilingBar } from '@/features/documents/components/filing-bar'
import type { FilingFolderSuggestion } from '@/features/documents/lib/filing-suggestions'
import { useTranslations } from '@/i18n'
import { projectIntakeCopy } from '@/i18n/namespaces/project-intake'
import { IntakeSection } from './intake-atoms'

export function FilingSection({
  entries,
  onSettled,
}: {
  entries: readonly FilingFolderSuggestion[]
  onSettled: () => void
}): JSX.Element | null {
  const t = useTranslations(projectIntakeCopy)
  if (entries.length === 0) return null
  return (
    <IntakeSection label={t('filing.heading')} description={t('filing.description')} testId="intake-filing">
      {/* `grid-cols-1`: the panel is a grid, and its implicit `auto` column grows
          to the widest file name in its lines (the detail line truncates, but
          only inside a column that is allowed to be narrower than it), which
          pushed the whole page 27px past a phone's edge. */}
      <FilingBar entries={entries} onSettled={onSettled} showNames className="grid-cols-1" />
    </IntakeSection>
  )
}
