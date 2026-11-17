'use client'

import type { FC } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { SectionLabel } from '@/components/ui/section-label'
import type { Translator } from '@/i18n'
import { formatTime } from '@/shared/utils/format-time'
import { stepNameLabel } from '../../lib/executed-steps'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'

export const technicalStepLabel = (step: StoredThinkingStep, t: Translator): string => {
  switch (step.kind) {
    case 'tool':
    case 'sources':
      return (step.tool && stepNameLabel(step.tool, t)) || step.tool || step.kind
    case 'status':
      return step.slot ?? step.kind
    case 'retrieval':
      return `retrieval:${step.round ?? ''}`
    case 'skill':
      return step.skill ?? t('thinking.nodeName.skillSelection')
    case 'clarification':
      return t('thinking.nodeName.clarification')
    case 'action':
      return step.action
        ? `${step.action.verb}${step.action.target ? `: ${step.action.target}` : ''}`
        : step.kind
    case 'look':
      return typeof step.detail?.document === 'string' ? `look: ${step.detail.document}` : step.kind
  }
}

export const TechnicalSteps: FC<{ steps: StoredThinkingStep[]; t: Translator }> = ({
  steps,
  t,
}) => (
  <Collapsible>
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className="focus-visible:ring-ring/60 group flex min-h-11 w-full items-center justify-between rounded-control py-1 text-left outline-none focus-visible:ring-2 pointer-fine:min-h-8"
      >
        <SectionLabel>{t('thinking.stepsHeading')}</SectionLabel>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <span>{steps.length}</span>
          <ChevronDown className="duration-quick size-3.5 transition-transform ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </span>
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div role="list" aria-label={t('thinking.stepsLabel')} className="pt-1">
        {steps.map((step) => (
          <div
            key={step.id}
            className="ml-1 flex w-full items-center justify-between py-1.5 pl-4"
            role="listitem"
          >
            <span className="text-foreground min-w-0 truncate text-sm">
              {technicalStepLabel(step, t)}
            </span>
            <span className="text-muted-foreground shrink-0 pl-4 text-xs">
              {formatTime(step.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </CollapsibleContent>
  </Collapsible>
)
