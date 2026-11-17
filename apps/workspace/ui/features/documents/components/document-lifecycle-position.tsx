'use client'

import type { JSX } from 'react'
import { StageTrack } from '@/components/ui/stage-track'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import { LIFECYCLE_STAGES, lifecycleMeaning, lifecycleProgress } from '../lib/document-lifecycle'

export interface DocumentLifecyclePositionProps {
  version: Pick<DocumentVersionView, 'state'> | null
  lifecycle: 'active' | 'archived'
  live?: boolean
  sentence?: string
  className?: string
}

export function DocumentLifecyclePosition({
  version,
  lifecycle,
  live = false,
  sentence,
  className,
}: DocumentLifecyclePositionProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const progress = lifecycleProgress(version, lifecycle)
  const meaning = lifecycleMeaning(version, lifecycle, { live })

  return (
    <div className={cn('space-y-1.5', className)} data-testid="document-lifecycle-position">
      <StageTrack
        stages={LIFECYCLE_STAGES}
        reached={progress.reached}
        halted={progress.halted}
        tone={progress.tone}
        data-testid="document-lifecycle-track"
      />
      <p className="text-muted-foreground text-xs" data-testid="document-lifecycle-meaning" data-meaning={meaning}>
        {sentence ?? t(`lifecycle.meaning.${meaning}`)}
      </p>
    </div>
  )
}
