'use client'

import type { JSX } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { StageTrack } from '@/components/ui/stage-track'
import { LIFECYCLE_STAGES } from '../lib/document-lifecycle'
import { answerText, nextStepText } from '../lib/revision-rail-copy'
import type { RevisionStanding, resolvePerson } from '../lib/revision-standing'
import { DocumentVersionStateBadge } from './document-version-badge'

const STAGE_LABEL_KEYS = [
  'lifecycle.states.draft',
  'lifecycle.states.inReview',
  'lifecycle.states.approved',
  'lifecycle.states.published',
] as const

export function RevisionHeader({
  standing,
  person,
  headerAct,
}: {
  standing: RevisionStanding
  person: (userId: string | null) => ReturnType<typeof resolvePerson>
  headerAct: string | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const stageLabels = STAGE_LABEL_KEYS.map((key) => t(key))
  const { progress, stage } = standing
  return (
    <div className="space-y-1.5" data-testid="revision-header">
      <p className="text-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug">
        {standing.number !== null && (
          <span className="font-medium" data-testid="revision-header-label">
            {t('preview.revision.rail.number', { number: standing.number })}
          </span>
        )}
        {standing.state && (
          <DocumentVersionStateBadge
            versionState={standing.state === 'archived' ? null : standing.state}
            lifecycle={standing.state === 'archived' ? 'archived' : 'active'}
            always
            className="bg-background"
            testId="document-lifecycle-state"
          />
        )}
      </p>
      {progress && stage !== null && (
        <div data-testid="document-lifecycle-position">
          <StageTrack
            stages={LIFECYCLE_STAGES}
            reached={progress.reached}
            halted={progress.halted}
            tone={progress.tone}
            labels={stageLabels}
            current={stage}
            data-testid="document-lifecycle-track"
          />
          <span className="sr-only">
            {t('preview.revision.rail.stepOf', { step: stage + 1, total: LIFECYCLE_STAGES.length, stage: stageLabels[stage] })}
          </span>
        </div>
      )}
      {standing.nextStep && (
        <p className="text-foreground text-xs leading-snug" data-testid="revision-next-step" data-step={standing.nextStep.kind}>
          {nextStepText(standing.nextStep, person, t, locale)}
        </p>
      )}
      <p className="text-muted-foreground text-xs leading-snug" data-testid="revision-answer" data-answer={standing.answer.kind}>
        {answerText(standing, t)}
      </p>
      {headerAct && (
        <p className="text-muted-foreground text-xs leading-snug" data-testid="revision-header-act">
          {headerAct}
        </p>
      )}
    </div>
  )
}
