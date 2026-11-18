'use client'

import { useState, type FC } from 'react'
import {
  Calculator,
  ChevronDown,
  FileImage,
  FileSpreadsheet,
  FileText,
  Presentation,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion, motionInstant, motionQuick, motionQuickExit } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { SectionLabel } from '@/components/ui/section-label'
import { PagePlaceDialog, type PagePlace } from '@/features/knowledge'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { DraftFileFormat } from '@/lib/conversations/draft-media'
import { cn } from '@/lib/utils'
import { useChatStore } from '../../store'
import { formatElapsed } from '../../hooks/use-elapsed-seconds'
import {
  LONG_RUN_MS,
  fileDisplayName,
  resultText,
  type FilePhase,
  type FileRunInput,
  type FileWork,
} from '../../lib/file-work'

const FORMAT_ICONS: Partial<Record<DraftFileFormat, LucideIcon>> = {
  excel: FileSpreadsheet,
  csv: FileSpreadsheet,
  powerpoint: Presentation,
  image: FileImage,
}

const iconOf = (work: FileWork): LucideIcon =>
  work.file ? (work.format && FORMAT_ICONS[work.format]) || FileText : Calculator

const vars = (t: Translator, work: FileWork): Record<string, string> => {
  const file = work.file ? fileDisplayName(work.file) : ''
  return { file, format: t(`thinking.files.format.${work.format ?? 'text'}`) }
}

export const fileWorkHeadline = (t: Translator, work: FileWork): string => {
  const values = vars(t, work)
  if (work.outcome === 'running') {
    const phase = work.phases.at(-1)?.kind ?? (work.file ? 'make' : 'calculate')
    return t(`thinking.files.running.${phase === 'prepare' ? 'make' : phase}`, values)
  }
  if (work.outcome === 'failed') return t(`thinking.files.failed.${work.failedKind ?? 'make'}`, values)
  return t(`thinking.files.settled.${work.outcome}`, values)
}

const longEnough = (ms: number | undefined): ms is number => ms !== undefined && ms >= LONG_RUN_MS

const placeOf = (input: FileRunInput): PagePlace | null =>
  input.documentId
    ? {
        document: { id: input.documentId, name: input.name, shelf: 'stored' },
        page: 1,
        frame: 'page',
        region: null,
      }
    : null

const InputLink: FC<{ input: FileRunInput }> = ({ input }) => {
  const t = useTranslations(chatCopy)
  const [open, setOpen] = useState(false)
  const place = placeOf(input)
  if (!place) return <span className="text-foreground">{input.name}</span>
  return (
    <>
      <button
        type="button"
        data-testid="file-work-input"
        aria-label={t('thinking.files.openInput', { name: input.name })}
        onClick={() => setOpen(true)}
        className={cn(
          'text-foreground rounded-control underline decoration-border underline-offset-2 outline-none transition-colors duration-snap ease-out pointer-fine:hover:decoration-foreground',
          FOCUS_RING
        )}
      >
        {input.name}
      </button>
      {open && <PagePlaceDialog place={place} open={open} onOpenChange={setOpen} />}
    </>
  )
}

const Inputs: FC<{ inputs: readonly FileRunInput[] }> = ({ inputs }) => {
  const t = useTranslations(chatCopy)
  if (inputs.length === 0) return null
  return (
    <p data-testid="file-work-inputs" className="text-muted-foreground text-[13px] leading-[19px]">
      {t('thinking.files.inputs')}{' '}
      {inputs.map((input, index) => (
        <span key={input.name}>
          {index > 0 && ', '}
          <InputLink input={input} />
        </span>
      ))}
    </p>
  )
}

const PhaseDot: FC<{ state: FilePhase['state'] }> = ({ state }) =>
  state === 'failed' ? (
    <TriangleAlert aria-hidden strokeWidth={2.4} className="text-foreground size-3" />
  ) : (
    <span
      aria-hidden
      className={cn(
        'size-1.5 rounded-full',
        state === 'running'
          ? 'bg-foreground animate-caret-breathe motion-reduce:animate-none'
          : 'bg-muted-foreground'
      )}
    />
  )

const PhaseList: FC<{ work: FileWork }> = ({ work }) => {
  const t = useTranslations(chatCopy)
  const ready = work.file && (work.outcome === 'made' || work.outcome === 'edited')
  return (
    <ol data-testid="file-work-phases" className="flex flex-col gap-1 py-1 pl-[26px]">
      {work.phases.map((phase, index) => (
        <li
          key={`${phase.kind}:${index}`}
          data-testid="file-work-phase"
          data-kind={phase.kind}
          data-state={phase.state}
          className="text-muted-foreground grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-2 text-[13px] leading-[19px]"
        >
          <span className="flex justify-center">
            <PhaseDot state={phase.state} />
          </span>
          <span className={cn(phase.state !== 'done' && 'text-foreground')}>
            {t(`thinking.files.phase.${phase.kind}.${phase.state}`)}
            {phase.state === 'running' && phase.attempts > 1 && ` · ${t('thinking.files.retrying')}`}
          </span>
          {longEnough(phase.elapsedMs) && (
            <span className="tabular-nums">{formatElapsed(Math.round(phase.elapsedMs / 1000))}</span>
          )}
        </li>
      ))}
      {ready && (
        <li
          data-testid="file-work-phase"
          data-kind="ready"
          data-state="done"
          className="text-muted-foreground grid grid-cols-[12px_minmax(0,1fr)] items-center gap-x-2 text-[13px] leading-[19px]"
        >
          <span className="flex justify-center">
            <span aria-hidden className="bg-muted-foreground size-1.5 rounded-full" />
          </span>
          <span>{t('thinking.files.phase.ready')}</span>
        </li>
      )}
    </ol>
  )
}

const retryPrompt = (t: Translator, work: FileWork): string =>
  t(`thinking.files.retryPrompt.${work.failedKind ?? 'make'}`, vars(t, work))

export const FileWorkRow: FC<{ work: FileWork; defaultOpen?: boolean }> = ({ work, defaultOpen = false }) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const reducedMotion = useReducedMotion()
  const [open, setOpen] = useState(defaultOpen)
  const Icon = iconOf(work)
  const headline = fileWorkHeadline(t, work)
  const running = work.outcome === 'running'
  const failed = work.outcome === 'failed'
  const meta = [
    running && work.attempts > 1 ? t('thinking.files.retrying') : null,
    !running && !failed && work.steps > 1 ? t('thinking.files.steps', { count: work.steps }) : null,
    !running && work.outcome === 'calculated' && work.result
      ? t('thinking.files.result', { result: resultText(work.result, locale) })
      : null,
    !running && longEnough(work.elapsedMs) ? formatElapsed(Math.round(work.elapsedMs / 1000)) : null,
  ].filter((part): part is string => Boolean(part))
  const enter = reducedMotion ? motionInstant : motionQuick
  const leave = reducedMotion ? motionInstant : motionQuickExit

  return (
    <li
      data-testid="file-work-row"
      data-outcome={work.outcome}
      className="flex min-w-0 flex-col"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-testid="file-work-toggle"
            className={cn(
              'group -mx-2 grid min-h-10 w-[calc(100%+1rem)] cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-control px-2 py-2 text-left text-[13px] leading-[19px] outline-none transition-[background-color,scale] duration-snap ease-out active:scale-[0.985] motion-reduce:transition-none pointer-coarse:min-h-11 pointer-fine:hover:bg-hover',
              FOCUS_RING
            )}
          >
            {failed ? (
              <TriangleAlert aria-hidden strokeWidth={1.8} className="text-foreground size-4" />
            ) : (
              <Icon aria-hidden strokeWidth={1.8} className="text-muted-foreground size-4" />
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {running && (
                <span
                  aria-hidden
                  className="bg-foreground animate-caret-breathe mr-1.5 inline-block size-1.5 rounded-full align-[1px] motion-reduce:animate-none"
                />
              )}
              <span className={cn('text-foreground', failed && 'font-medium')}>{headline}</span>
              {meta.length > 0 && (
                <span data-testid="file-work-meta" className="text-muted-foreground tabular-nums">
                  {` · ${meta.join(' · ')}`}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden
              strokeWidth={1.8}
              className="text-muted-foreground duration-quick size-4 transition-transform ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </button>
        </CollapsibleTrigger>
        <AnimatePresence initial={false}>
          {open && (
            <CollapsibleContent forceMount asChild>
              <motion.div
                key="phases"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: enter }}
                exit={{ opacity: 0, transition: leave }}
              >
                <PhaseList work={work} />
                <div className="pl-[26px]">
                  <Inputs inputs={work.documents} />
                </div>
              </motion.div>
            </CollapsibleContent>
          )}
        </AnimatePresence>
      </Collapsible>
      {failed && (
        <div data-testid="file-work-failed" className="flex flex-col items-start gap-2 pb-2 pl-[26px]">
          <p className="text-muted-foreground text-[13px] leading-[19px]">
            {t(
              work.failedReason === 'too_large'
                ? 'thinking.files.failedNote.tooLarge'
                : work.failedReason === 'not_written'
                  ? 'thinking.files.failedNote.notWritten'
                  : work.file
                    ? 'thinking.files.failedNote.file'
                    : 'thinking.files.failedNote.calculate'
            )}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="file-work-retry"
            onClick={() => useChatStore.getState().setComposerPrefill(retryPrompt(t, work))}
          >
            <RotateCcw aria-hidden className="size-3.5" />
            {t('thinking.files.retry')}
          </Button>
        </div>
      )}
    </li>
  )
}

export const FileWorkList: FC<{ works: readonly FileWork[]; className?: string }> = ({ works, className }) => {
  const t = useTranslations(chatCopy)
  if (works.length === 0) return null
  const files = works.some((work) => work.file)
  const calculations = works.some((work) => !work.file)
  const heading = files && calculations ? 'both' : files ? 'files' : 'calculations'
  return (
    <section data-testid="file-work" className={cn('flex flex-col gap-1', className)}>
      <SectionLabel as="h3">{t(`thinking.files.heading.${heading}`)}</SectionLabel>
      <ul aria-label={t(`thinking.files.heading.${heading}`)} className="flex flex-col">
        {works.map((work) => (
          <FileWorkRow key={work.key} work={work} />
        ))}
      </ul>
    </section>
  )
}
