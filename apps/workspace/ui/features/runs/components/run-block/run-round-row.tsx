'use client'

import type { FC } from 'react'

import {
  fadeRise,
  motion,
  motionEntrance,
  motionInstant,
  motionQuick,
  staggerMaxSteps,
  staggerStepSeconds,
} from '@/components/motion'
import { Item } from '@/components/ui/item'
import { useTranslations } from '@/i18n'
import { runsCopy } from '@/i18n/namespaces/runs'
import type { RunStep } from '@/lib/runs/run-ledger-types'
import { DocChip } from './run-doc-chip'
import { Sep } from './run-separator'

const FADE = { hidden: { opacity: 0 }, visible: { opacity: 1 } }

export const RoundRow: FC<{ step: RunStep; index: number; reduced: boolean }> = ({
  step,
  index,
  reduced,
}) => {
  const t = useTranslations(runsCopy)
  const intent = step.intent.trim() || t('step.fallback', { n: index + 1 })
  const chipDelay = (position: number): number =>
    Math.min(position, staggerMaxSteps) * staggerStepSeconds
  const afterChips = (Math.min(step.docs.length, staggerMaxSteps) + 1) * staggerStepSeconds
  const fadeAfter = (delay: number) => (reduced ? motionInstant : { ...motionQuick, delay })
  return (
    <Item as="li" className="flex-col items-stretch gap-1 px-3 py-2 hover:bg-transparent" asChild>
      <motion.li
        data-testid="run-step"
        variants={fadeRise}
        initial="hidden"
        animate="visible"
        transition={reduced ? motionInstant : motionEntrance}
      >
        <p className="text-foreground text-xs leading-snug">
          <span className="font-medium tabular-nums">{t('step.round', { n: index + 1 })}</span>
          <Sep />
          {intent}
        </p>
        {step.docs.length > 0 && (
          <div className="flex flex-wrap gap-1" role="list">
            {step.docs.map((doc, position) => (
              <motion.span
                role="listitem"
                key={doc.name}
                className="inline-flex max-w-full"
                variants={FADE}
                transition={fadeAfter(chipDelay(position))}
              >
                <DocChip doc={doc} reduced={reduced} />
              </motion.span>
            ))}
          </div>
        )}
        {step.findings && step.findings.length > 0 && (
          <motion.ul
            className="text-foreground text-xs leading-relaxed"
            data-testid="run-findings"
            variants={FADE}
            transition={fadeAfter(afterChips)}
            aria-label={t('step.findings')}
          >
            {step.findings.map((finding) => (
              <li key={finding} className="flex gap-1.5">
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span>{finding}</span>
              </li>
            ))}
          </motion.ul>
        )}
        {step.openPoints && step.openPoints.length > 0 && (
          <motion.p
            className="text-muted-foreground text-xs leading-relaxed"
            data-testid="run-open-points"
            variants={FADE}
            transition={fadeAfter(afterChips)}
          >
            <span className="font-medium">{t('step.openPoints')}</span>{' '}
            {step.openPoints.join(' · ')}
          </motion.p>
        )}
      </motion.li>
    </Item>
  )
}
