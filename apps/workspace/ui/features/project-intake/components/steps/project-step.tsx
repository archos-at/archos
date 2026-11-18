'use client'

import { useState, type JSX } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { intakeProjectStepCopy } from '@/i18n/namespaces/intake-project-step'
import { createParticipantsClient, type ParticipantsClient } from '@/lib/projects/participants-client'
import { PRIMARY_ACTION_CLASS, StepFooter } from '../setup-frame'
import { DialogFactsSection } from '../project/dialog-facts-section'
import { ParticipantsSection } from '../project/participants-section'
import { useParticipants } from '../project/use-participants'
import type { SetupStepProps } from './types'

export interface ProjectStepProps extends SetupStepProps {
  client?: ParticipantsClient
}

export function ProjectStep({ view, projectId, busy, canDecide, onDecide, onNext, client: given }: ProjectStepProps): JSX.Element {
  const t = useTranslations(intakeProjectStepCopy)
  const [client] = useState(() => given ?? createParticipantsClient())
  const participants = useParticipants(projectId, client)

  return (
    <div className="mx-auto w-full max-w-[960px]" data-testid="setup-step-project">
      <h1 className="text-page-title">{t('title')}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{t('intro')}</p>
      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:mt-[26px] lg:grid-cols-2 lg:gap-6">
        <DialogFactsSection
          view={view}
          projectId={projectId}
          project={participants.project}
          peopleRecord={participants.peopleRecord}
          canDecide={canDecide}
          busy={busy}
          onDecide={onDecide}
        />
        <ParticipantsSection
          projectId={projectId}
          client={client}
          peopleRecord={participants.peopleRecord}
          roster={participants.roster}
          loading={participants.loading}
          reload={participants.reload}
        />
      </div>
      {onNext && (
        <StepFooter
          primary={
            <Button type="button" onClick={onNext} className={PRIMARY_ACTION_CLASS}>
              {t('next')}
              <ArrowRight aria-hidden />
            </Button>
          }
        />
      )}
    </div>
  )
}
