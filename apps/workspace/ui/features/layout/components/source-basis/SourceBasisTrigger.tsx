'use client'

import { forwardRef, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { ChevronDown, Layers } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import {
  AnimatePresence,
  motion,
  springSnap,
  useIconSwapTransition,
  useMotionToken,
} from '@/components/motion'
import { cn } from '@/lib/utils'
import { useAuth } from '@/adapters/auth'
import { useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'
import { useLayoutStore } from '../../store'
import type { SourceSignal } from '@/lib/source-kinds'
import { iconForTint } from '../SourceSignalChip'
import { buildSourceBasis, summariseBasis, type BasisSummary } from './source-basis-model'

const SIGNAL_TEXT: Record<SourceSignal, string> = {
  law: 'text-source-law-text',
  office: 'text-source-office-text',
  project: 'text-source-project-text',
  model: 'text-source-model-text',
  auto: 'text-source-auto-text',
}

const PRESET_SIGNAL: Record<'law' | 'project' | 'office', SourceSignal> = {
  law: 'law',
  project: 'project',
  office: 'office',
}

const StratumUnit = ({ signal, label }: { signal: SourceSignal; label: string }) => {
  const Icon = iconForTint(signal)
  const swap = useIconSwapTransition()
  return (
    <motion.span
      layout="position"
      initial={{ opacity: 0, x: 4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -4, transition: swap.exit }}
      transition={swap.enter}
      className={cn('inline-flex items-center gap-1', SIGNAL_TEXT[signal])}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </motion.span>
  )
}

export interface SourceBasisTriggerProps extends ComponentProps<typeof Button> {
  pickerOpen?: boolean
}

export const SourceBasisTrigger = forwardRef<HTMLButtonElement, SourceBasisTriggerProps>(
  function SourceBasisTrigger({ className, pickerOpen = false, ...props }, ref) {
    const t = useTranslations(researchCopy)
    const receiptTransition = useMotionToken(springSnap)
    const { idToken } = useAuth()

    const enabledDataSourceIds = useLayoutStore((s) => s.enabledDataSourceIds)
    const availableDataSources = useLayoutStore((s) => s.availableDataSources)
    const knowledgeLayerAvailable = useLayoutStore((s) => s.knowledgeLayerAvailable)
    const activeSourcePreset = useLayoutStore((s) => s.activeSourcePreset)

    const summary: BasisSummary = useMemo(() => {
      const basis = buildSourceBasis({
        sources: availableDataSources,
        enabledIds: enabledDataSourceIds,
        knowledgeLayerAvailable,
        hasValidToken: !!idToken,
        labels: {
          projectName: t('sourceBasis.knowledge.projectName'),
          projectDescription: t('sourceBasis.knowledge.projectDescription'),
          officeName: t('sourceBasis.knowledge.officeName'),
          officeDescription: t('sourceBasis.knowledge.officeDescription'),
          signInRequired: t('sourceBasis.signInReason'),
        },
      })
      return summariseBasis(basis, activeSourcePreset)
    }, [
      availableDataSources,
      enabledDataSourceIds,
      knowledgeLayerAvailable,
      idToken,
      activeSourcePreset,
      t,
    ])

    const signature = `${summary.kind}:${summary.preset ?? ''}:${summary.strata.join(',')}:${summary.overflow}`
    const previousSignature = useRef(signature)
    const [receipt, setReceipt] = useState(0)
    useEffect(() => {
      if (previousSignature.current === signature) return
      previousSignature.current = signature
      if (!pickerOpen) setReceipt((n) => n + 1)
    }, [signature, pickerOpen])

    const label =
      summary.kind === 'all'
        ? t('sourceBasis.allSources')
        : summary.kind === 'internalOnly'
          ? t('sourceBasis.internalOnly')
          : summary.kind === 'preset' && summary.preset
            ? t(`sourceBasis.presets.${summary.preset}`)
            : summary.strata.map((signal) => t(`sourceBasis.strata.${signal}`)).join(', ')

    return (
      <Button
        ref={ref}
        type="button"
        variant="secondary"
        size="sm"
        className={cn('max-w-[min(15rem,60vw)] shrink-0 gap-2 text-muted-foreground', className)}
        aria-label={t('sourceBasis.triggerAria', { summary: label })}
        {...props}
      >
        <motion.span
          key={`receipt-${receipt}`}
          initial={{ y: -2 }}
          animate={{ y: 0 }}
          transition={receiptTransition}
          className="inline-flex items-center gap-2"
        >
          {summary.kind === 'all' ? (
            <span className="inline-flex items-center gap-1.5">
              <Layers className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('sourceBasis.allSources')}</span>
            </span>
          ) : summary.kind === 'preset' && summary.preset ? (
            <StratumUnit
              signal={PRESET_SIGNAL[summary.preset]}
              label={t(`sourceBasis.presets.${summary.preset}`)}
            />
          ) : summary.kind === 'internalOnly' ? (
            <StratumUnit signal="project" label={t('sourceBasis.internalOnly')} />
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              {summary.strata.map((signal) => (
                <StratumUnit
                  key={signal}
                  signal={signal}
                  label={t(`sourceBasis.strata.${signal}`)}
                />
              ))}
            </AnimatePresence>
          )}
          {summary.overflow > 0 && (
            <CountPill aria-label={t('sourceBasis.overflowAria', { count: summary.overflow })}>
              +{summary.overflow}
            </CountPill>
          )}
        </motion.span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </Button>
    )
  }
)
