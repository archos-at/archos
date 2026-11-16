'use client'

import { useState, type FC } from 'react'
import { ChevronDown, Sigma } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import {
  SchematicCard,
  fmtComparator,
  fmtNum,
  fmtTolerance,
  provenanceLabel,
  provenanceTitle,
} from '../schematics/kit'
import { evaluate, formatInput, resultDecimals, verdictFor } from '../lib/calculate'
import { cn } from '@/lib/utils'
import type { CalculationLimitData, CalculationStepData, NormReferenceData } from '@/shared/cards/schemas'
import { DerivationSteps } from './Derivation'

interface CalculationCardProps {
  title: string
  steps: CalculationStepData[]
  limit?: CalculationLimitData | null
  reference?: NormReferenceData | null
  note?: string | null
}

const LimitLine: FC<{ limit: CalculationLimitData; unit: string; t: Translator }> = ({ limit, unit, t }) => {
  const suffix = unit ? ` ${unit}` : ''
  const text =
    limit.comparator === 'between'
      ? t('cards.calculation.limitRange', {
          lower: fmtNum(limit.value),
          upper: fmtNum(limit.upper ?? limit.value),
          unit,
        })
      : `${fmtComparator(limit.comparator)} ${fmtNum(limit.value)}${suffix}`

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <SectionLabel>{t('cards.calculation.limitLabel')}</SectionLabel>
      <span className="font-mono text-foreground">{text}</span>
      {limit.label && <span className="text-muted-foreground">{limit.label}</span>}
      {limit.reference && (
        <span className="text-muted-foreground">
          {limit.reference.document}
          {limit.reference.section && <span className="ml-1 font-mono">{limit.reference.section}</span>}
        </span>
      )}
    </div>
  )
}

export const CalculationCard: FC<CalculationCardProps> = ({ title, steps, limit, reference, note }) => {
  const t = useTranslations(chatCopy)
  const [open, setOpen] = useState(false)

  const results = evaluate(steps)
  const final = results[results.length - 1]
  const verdict = final ? verdictFor(final, limit) : null
  const decimals = final ? resultDecimals(final, limit) : 2

  const documented = steps.flatMap((step) =>
    step.operands.filter((operand) => operand.step == null && (operand.provenance || operand.tolerance || operand.source))
  )

  return (
    <SchematicCard
      icon={Sigma}
      eyebrow={t('cards.calculation.eyebrow')}
      title={title}
      verdict={verdict}
      note={note}
      reference={reference}
    >
      <DerivationSteps
        steps={steps}
        results={results}
        display={steps.map((_, index) => ({ decimals: index === steps.length - 1 ? decimals : 2 }))}
        tint={verdict}
        t={t}
      />

      {limit && <LimitLine limit={limit} unit={final?.unit ?? ''} t={t} />}

      {/* The band reaches over the bound: at this precision the derivation is
          on both sides of the line, and the same sentence the schematics use
          for a straddling measurement says so here. */}
      {verdict === 'warning' && (
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {t('cards.kit.toleranceStraddlesLimit')}
        </p>
      )}

      {documented.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger
            className={cn(
              '-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 touch-target',
              'text-xs font-medium text-muted-foreground',
              'transition-colors duration-quick ease-out hover:text-foreground',
              'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2'
            )}
          >
            {open ? t('cards.calculation.sourcesLess') : t('cards.calculation.sourcesMore')}
            <ChevronDown
              className={cn(
                'size-3.5',
                'transition-transform duration-quick ease-out motion-reduce:transition-none',
                open && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="mt-1.5 flex flex-col gap-1.5 pl-3">
              {documented.map((operand, index) => {
                const unit = operand.unit ?? ''
                const band = operand.provenance === 'computed' ? fmtTolerance(operand.tolerance, unit) : null
                return (
                  <div key={`${operand.label}-${index}`} className="flex flex-col gap-0.5 text-xs">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-muted-foreground">{operand.label}</span>
                      {operand.value != null && (
                        <span className="font-mono text-foreground">
                          {formatInput(operand.value)}
                          {unit && ` ${unit}`}
                        </span>
                      )}
                      {band && <span className="text-muted-foreground">{band}</span>}
                      {operand.provenance && (
                        <span
                          className="rounded bg-muted px-1 py-px text-[0.9em] text-muted-foreground"
                          title={provenanceTitle(operand.provenance, t)}
                        >
                          {provenanceLabel(operand.provenance, t)}
                        </span>
                      )}
                    </div>
                    {operand.source && (
                      <span className="text-[0.92em] leading-snug text-muted-foreground">{operand.source}</span>
                    )}
                  </div>
                )
              })}
              <p className="mt-0.5 max-w-prose text-[0.92em] leading-relaxed text-muted-foreground">
                {t('cards.calculation.computedNote')}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </SchematicCard>
  )
}
