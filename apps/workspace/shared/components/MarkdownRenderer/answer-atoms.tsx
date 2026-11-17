'use client'

import { useState, type FC, type ReactNode } from 'react'
import { ArrowDown, Check, ChevronDown, CircleAlert, CircleCheck, ExternalLink, ListPlus, PencilLine } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Quote } from '@/components/ui/quote'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'
import { ENERGY_CLASSES } from '@/lib/text/answer-directives'
import type { StatusTone } from './status-marks'
import type { BoundFactState } from '@/lib/project-profile/answer-bindings'
import type { Ruler } from './cases'

export interface ValueBarProps {
  value: number
  limit: number
  bound: 'min' | 'max'
  pass: boolean
  valueText: string
  limitText: string
}

export const ValueBar: FC<ValueBarProps> = ({ value, limit, bound, pass, valueText, limitText }) => {
  const t = useTranslations(commonCopy)
  const top = Math.max(Math.abs(value), Math.abs(limit)) * 1.1 || 1
  const fill = Math.min(100, (Math.max(0, value) / top) * 100)
  const tick = Math.min(100, (Math.max(0, limit) / top) * 100)
  return (
    <span
      role="img"
      data-testid="value-bar"
      data-pass={pass ? 'true' : 'false'}
      data-bound={bound}
      aria-label={t('markdown.valueBar', {
        value: valueText,
        limit: limitText,
        verdict: t(pass ? 'markdown.limitKept' : 'markdown.limitMissed'),
      })}
      className="relative mt-1.5 block h-1.5 w-full min-w-16 max-w-40 rounded-full bg-muted"
    >
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', pass ? 'bg-success' : 'bg-danger')}
        style={{ width: `${fill}%` }}
      />
      <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground/70" style={{ left: `calc(${tick}% - 1px)` }} />
      {/* On paper the bar keeps its numbers: a drawn value always exists as text (guardrail 4). */}
      <span className="card-meta absolute left-0 top-2 hidden whitespace-nowrap text-muted-foreground print:block">
        {valueText} / {limitText}
      </span>
    </span>
  )
}

export const tableRowClass = ({ active, muted, conflict = false }: { active: boolean; muted: boolean; conflict?: boolean }): string =>
  cn(
    'border-base border-t first:border-t-0',
    conflict && 'bg-warning-subtle',
    active && 'bg-success-subtle',
    muted && '[&>td]:text-muted-foreground'
  )

export const ListCase: FC<{ active: boolean; muted: boolean; id?: string; compact: boolean; children: ReactNode }> = ({
  active,
  muted,
  id,
  compact,
  children,
}) => (
  <li
    id={id}
    data-active={active ? 'true' : undefined}
    className={cn(
      compact ? 'text-sm' : 'text-answer',
      muted ? 'text-muted-foreground' : 'text-foreground',
      active && '-ml-2 rounded-control bg-success-subtle py-0.5 pl-2'
    )}
  >
    {children}
  </li>
)

export const MarkChip: FC<{ tone?: 'success' | 'muted'; children: ReactNode }> = ({ tone = 'success', children }) => (
  <span
    data-testid="answer-mark"
    className={cn(
      'card-meta ml-1.5 inline-flex h-5 items-center rounded-full px-2 align-[1px]',
      tone === 'success' ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground'
    )}
  >
    {children}
  </span>
)

export type StepPhase = 'none' | 'done' | 'current' | 'upcoming'

export const StepList: FC<{ ordered: boolean; children: ReactNode }> = ({ ordered, children }) => {
  const Tag = ordered ? 'ol' : 'ul'
  return <Tag className="my-4 flex list-none flex-col pl-0">{children}</Tag>
}

export const StepStation: FC<{ phase: StepPhase; number: string; last: boolean; children: ReactNode }> = ({
  phase,
  number,
  last,
  children,
}) => (
  <li className="relative grid grid-cols-[26px_minmax(0,1fr)]" data-phase={phase}>
    <span
      aria-hidden="true"
      className={cn('absolute left-[10px] top-0 w-px', last ? 'h-[15px]' : 'bottom-0', phase === 'done' ? 'bg-foreground/40' : 'bg-border')}
    />
    <span
      aria-hidden="true"
      className={cn(
        'absolute left-[10px] top-[15px] flex size-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-mono text-[10px] tabular-nums',
        phase === 'done' && 'bg-foreground/70 text-background',
        phase === 'current' && 'bg-success text-background',
        (phase === 'none' || phase === 'upcoming') && 'border border-border bg-card text-muted-foreground'
      )}
    >
      {phase === 'done' ? <Check className="size-3.5" /> : number}
    </span>
    <div className="col-start-2 min-w-0 pb-1.5">{children}</div>
  </li>
)

export const StepLine: FC<{
  phase: StepPhase
  number?: string
  title: ReactNode
  due?: ReactNode
  open?: boolean
  expandable: boolean
}> = ({
  phase,
  number,
  title,
  due,
  open,
  expandable,
}) => {
  const t = useTranslations(commonCopy)
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-1">
        <span
          className={cn(
            'min-w-0 flex-[1_1_9rem] text-left text-answer leading-[1.5]',
            phase === 'current' ? 'font-medium text-foreground' : 'text-default',
            phase === 'done' && 'text-muted-foreground'
          )}
        >
          {number && <span className="sr-only">{t('markdown.stepAria', { step: number, label: '' }).trim()} </span>}
          {title}
        </span>
        <span className="flex min-w-0 flex-wrap items-start gap-2">
          {/* A done step's check mark and muted text are colour and shape; its word is for everyone else. */}
          {phase === 'done' && <span className="sr-only">{t('markdown.stepDone')}</span>}
          {due && <span className="card-meta mt-0.5 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{due}</span>}
          {phase === 'current' && (
            <span className="card-meta mt-0.5 rounded-full bg-success-subtle px-2 py-0.5 text-success">
              {t('markdown.stepCurrent')}
            </span>
          )}
        </span>
      </span>
      {expandable && (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-quick ease-out motion-reduce:transition-none print:hidden',
            open && 'rotate-180'
          )}
        />
      )}
    </>
  )
}

export const PRINT_OPEN_CONTENT = 'data-[state=closed]:hidden print:data-[state=closed]:block'

export const disclosureRowClass = ({ current, open }: { current: boolean; open: boolean }): string =>
  cn(
    'flex w-full min-w-0 items-start gap-2 rounded-control px-2 py-1.5 text-left touch-target',
    'transition-colors duration-quick ease-out motion-reduce:transition-none',
    'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2',
    current ? 'bg-success-subtle' : open ? 'bg-muted/60' : 'hover:bg-muted/50'
  )

export const DisclosurePanel: FC<{ current?: boolean; children: ReactNode }> = ({ current, children }) => (
  <div
    className={cn(
      'mt-1.5 flex flex-col gap-2 rounded-surface px-3 py-2.5 text-sm [&>*:last-child]:mb-0',
      current ? 'border border-success' : 'border border-dashed bg-muted/30'
    )}
  >
    {children}
  </div>
)

export const InlineDetailsLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <SectionLabel as="p" className="mb-1">
    {children}
  </SectionLabel>
)

export const DetailsFrame: FC<{ children: ReactNode }> = ({ children }) => <div className="my-3">{children}</div>

export const DetailsSummary: FC<{ children: ReactNode; open: boolean }> = ({ children, open }) => (
  <>
    <span className="min-w-0 flex-1 text-answer font-medium leading-[1.5] text-foreground">{children}</span>
    <ChevronDown
      aria-hidden="true"
      className={cn(
        'mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-quick ease-out motion-reduce:transition-none print:hidden',
        open && 'rotate-180'
      )}
    />
  </>
)

export type FigureTone = StatusTone | 'none'

const FIGURE_INK: Record<FigureTone, string> = {
  success: 'text-success',
  destructive: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
  muted: 'text-foreground',
  none: 'text-foreground',
}

const FIGURE_SWATCH: Record<FigureTone, string> = {
  success: 'bg-success',
  destructive: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  muted: 'bg-muted-foreground',
  none: '',
}

export const FigureGrid: FC<{ count: number; children: ReactNode }> = ({ count, children }) => (
  <div className="my-4 @container break-inside-avoid">
    <div
      data-testid="figure-grid"
      data-count={count}
      className={cn(
        'grid gap-2',
        count <= 1 && 'grid-cols-1 @[28rem]:max-w-[50%]',
        count === 2 && 'grid-cols-2',
        count === 3 && 'grid-cols-1 @[26rem]:grid-cols-3',
        count >= 4 && 'grid-cols-2 @[44rem]:grid-cols-4'
      )}
    >
      {children}
    </div>
  </div>
)

export const FigureTile: FC<{
  tone: FigureTone
  value: ReactNode
  label: ReactNode
  limit?: ReactNode
  verdict?: string
}> = ({ tone, value, label, limit, verdict }) => {
  const t = useTranslations(commonCopy)
  return (
    <div data-testid="figure-tile" data-tone={tone} className="flex min-w-0 flex-col gap-1 rounded-surface bg-muted/40 px-3.5 py-3">
      <span className={cn('card-figure-24 break-words', FIGURE_INK[tone])}>{value}</span>
      <span className="card-caption flex items-baseline gap-1.5 text-default">
        {tone !== 'none' && <span aria-hidden="true" className={cn('size-2.5 shrink-0 translate-y-px rounded-[3px]', FIGURE_SWATCH[tone])} />}
        <span className="min-w-0">{label}</span>
      </span>
      {(limit || verdict) && (
        <span className="card-meta text-muted-foreground">
          {limit && (
            <>
              {t('markdown.figureLimit')} {limit}
            </>
          )}
          {limit && verdict && ' · '}
          {verdict}
        </span>
      )}
    </div>
  )
}

export const EnergyClassChip: FC<{ rating: string }> = ({ rating }) => {
  const t = useTranslations(commonCopy)
  const band = (ENERGY_CLASSES as readonly string[]).indexOf(rating) + 1
  if (band <= 0) return <>{rating}</>
  return (
    <abbr
      title={t('markdown.energyClass', { rating })}
      data-testid="energy-class"
      data-class={rating}
      className="mx-0.5 inline-flex h-5 min-w-7 items-center justify-center rounded-full px-1.5 align-[1px] text-[12px] font-semibold no-underline"
      style={{
        backgroundColor: `var(--energy-band-${band})`,
        color: band === ENERGY_CLASSES.length ? 'var(--energy-band-paper)' : 'var(--energy-band-ink)',
      }}
    >
      {rating}
    </abbr>
  )
}

export const ExcerptFigure: FC<{
  number: string
  source: ReactNode
  stamp?: ReactNode
  paraphrase?: boolean
  children: ReactNode
}> = ({ number, source, stamp, paraphrase = false, children }) => (
  <figure className="my-5 @container break-inside-avoid" data-excerpt={number} data-paraphrase={paraphrase ? 'true' : undefined}>
    <div className={cn('grid gap-2', source && '@[36rem]:grid-cols-[minmax(0,1fr)_12rem] @[36rem]:gap-6')}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {/* The wording on a quiet ground; a paraphrase upright on a dashed
            hairline, its stamp below saying so in words. */}
        <Quote
          variant={paraphrase ? 'paraphrase' : 'excerpt'}
          className="max-w-prose leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0"
        >
          {children}
        </Quote>
        {stamp}
      </div>
      {source && <figcaption className="min-w-0 pl-4 @[36rem]:pl-0 @[36rem]:pt-0.5">{source}</figcaption>}
    </div>
  </figure>
)

export const ExcerptMargin: FC<{ title: ReactNode; locus?: ReactNode; action?: ReactNode }> = ({ title, locus, action }) => {
  const t = useTranslations(commonCopy)
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel as="p">{t('markdown.excerptSource')}</SectionLabel>
      <p className="card-caption break-words font-medium text-foreground">{title}</p>
      {locus && <div className="card-meta text-muted-foreground">{locus}</div>}
      {action && <div className="mt-0.5">{action}</div>}
    </div>
  )
}

export const CompareStackFrame: FC<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="compare-stack" className="my-4 hidden flex-col gap-2 @max-[30rem]/compare:flex">
    {children}
  </div>
)

export const CompareVariantCard: FC<{ recommended: boolean; children: ReactNode }> = ({ recommended, children }) => (
  <section
    data-recommended={recommended ? 'true' : undefined}
    className={cn('flex flex-col gap-1.5 rounded-surface px-3.5 py-3', recommended ? 'bg-card shadow-xs ring-1 ring-border' : 'bg-muted/40')}
  >
    {children}
  </section>
)

export const CompareVariantTitle: FC<{ recommended: boolean; children: ReactNode }> = ({ recommended, children }) => {
  const t = useTranslations(commonCopy)
  return (
    <p className="card-title text-foreground">
      {children}
      {recommended && <MarkChip>{t('markdown.recommended')}</MarkChip>}
    </p>
  )
}

export const CompareVariantRow: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-[38%_minmax(0,1fr)] items-baseline gap-3 text-sm">{children}</div>
)

export const CompareVariantLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="card-caption text-muted-foreground">{children}</span>
)

export const CompareVariantValue: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="min-w-0 text-foreground">{children}</span>
)

export type TableVariant = 'plain' | 'check' | 'cases' | 'compare' | 'actions'

export const tableVariant = (value: unknown): TableVariant =>
  value === 'check' || value === 'cases' || value === 'compare' || value === 'actions' ? value : 'plain'

export const tableFrameClass = (variant: TableVariant): string =>
  cn(
    'my-4 flex flex-col gap-2 [container:answer-table/inline-size] break-inside-avoid',
    variant === 'compare' && '@max-[30rem]/compare:hidden'
  )

export const tableClass = (variant: TableVariant): string =>
  cn(
    'min-w-full caption-bottom tabular-nums [&>tbody>tr:nth-child(even):not([data-active]):not([data-conflict])]:bg-muted/30',
    (variant === 'compare' || variant === 'actions' || variant === 'cases') && '[&_td]:align-top [&_th]:align-bottom',
    variant === 'compare' &&
      '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-10 [&_td:first-child]:bg-card [&_th:first-child]:bg-muted'
  )

export const headerCellClass = ({ align, recommended }: { align: string; recommended: boolean }): string =>
  cn('text-foreground px-3 py-2 text-sm font-medium', align, recommended && 'bg-success-subtle')

export const dataCellClass = ({ align, recommended }: { align?: string; recommended: boolean }): string =>
  cn('text-foreground px-3 py-2 text-sm', align, recommended && 'bg-success-subtle')

export function useOutcomeLabel(): (word: string, where: 'cell' | 'tally') => string {
  const t = useTranslations(commonCopy)
  return (word, where) => {
    if (word === '@pass') return t('markdown.limitKept')
    if (word === '@fail') return t('markdown.limitMissed')
    if (word === '@conflict') return t(where === 'tally' ? 'markdown.tallyConflict' : 'markdown.outcomeConflict')
    return word
  }
}

export const PassedCheck: FC<{ passed: number; children: ReactNode }> = ({ passed, children }) => {
  const t = useTranslations(commonCopy)
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-4">
      <CollapsibleTrigger
        data-testid="check-passed"
        className={disclosureRowClass({ current: false, open })}
        aria-label={`${t('markdown.allPassed', { passed, total: passed })} – ${t('markdown.showRows')}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Chip size="md" variant="success">
            <CircleCheck aria-hidden="true" />
            {t('markdown.allPassed', { passed, total: passed })}
          </Chip>
          <span className="card-caption text-muted-foreground">{t('markdown.showRows')}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-quick ease-out motion-reduce:transition-none print:hidden',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className={PRINT_OPEN_CONTENT}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export const cellChipClass = '-my-0.5 align-[1px]'

export const ProjectValueChip: FC<{
  state: BoundFactState
  children: ReactNode
  label: string
  reason?: string
  onFill?: () => void
}> = ({ state, children, label, reason, onFill }) => {
  const t = useTranslations(commonCopy)
  const base = 'mx-0.5 inline-flex h-[1.375rem] max-w-full items-center gap-1 rounded-control border px-1.5 align-[1px] text-[0.8125rem] font-medium leading-none tabular-nums'
  if (state === 'missing') {
    const body = (
      <>
        <span className="truncate">{label}</span>
        <span className="text-warning">{t('markdown.project.missing')}</span>
        {onFill && <PencilLine aria-hidden="true" className="size-3 shrink-0 print:hidden" />}
      </>
    )
    const className = cn(base, 'bg-hatch-warning border-warning border-dashed text-foreground')
    return onFill ? (
      <button
        type="button"
        data-testid="project-value"
        data-state="missing"
        onClick={onFill}
        title={t('markdown.project.fillTitle', { label })}
        className={cn(className, 'cursor-pointer touch-target hover:border-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60')}
      >
        {body}
      </button>
    ) : (
      <span data-testid="project-value" data-state="missing" className={className}>
        {body}
      </span>
    )
  }
  return (
    <span
      data-testid="project-value"
      data-state={state}
      title={state === 'assumed' && reason ? `${label}: ${t('markdown.project.assumed')} – ${reason}` : label}
      className={cn(
        base,
        state === 'confirmed' ? 'border-transparent bg-muted text-foreground' : 'border-dashed border-border bg-card text-foreground'
      )}
    >
      <span className="truncate">{children}</span>
      {state === 'assumed' && <span className="card-meta font-normal text-muted-foreground">{t('markdown.project.assumed')}</span>}
    </span>
  )
}

export const ProjectStrip: FC<{ children: ReactNode }> = ({ children }) => {
  const t = useTranslations(commonCopy)
  return (
    <div data-testid="project-strip" className="flex flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-base pb-2.5">
      <SectionLabel as="span" className="mr-1">
        {t('markdown.project.strip')}
      </SectionLabel>
      {children}
    </div>
  )
}

export const StripSeparator: FC = () => (
  <span aria-hidden="true" className="text-muted-foreground">
    ·
  </span>
)

export const CaseProjectLine: FC<{ children: ReactNode }> = ({ children }) => {
  const t = useTranslations(commonCopy)
  return (
    <p data-testid="case-project" className="card-caption flex flex-wrap items-center gap-1 text-muted-foreground">
      {t('markdown.project.yours')}
      {children}
    </p>
  )
}

export const ThresholdRuler: FC<{
  ruler: Ruler
  valueText: string
  format: (value: number) => string
  label: string
}> = ({ ruler, valueText, format, label }) => {
  const t = useTranslations(commonCopy)
  const nearest = ruler.nearest
  const note = nearest
    ? t(nearest.direction === 'below' ? 'markdown.ruler.below' : 'markdown.ruler.above', {
        delta: format(nearest.delta),
        label: nearest.label,
      })
    : null
  const holds = ruler.segments.find((segment) => segment.holds)
  return (
    <figure
      data-testid="threshold-ruler"
      className="my-1 flex flex-col gap-1 break-inside-avoid"
      aria-label={t('markdown.ruler.aria', { label, value: valueText, case: holds?.label ?? '–', note: note ?? '' })}
      role="img"
    >
      <div className="relative mx-2 mt-6 h-2">
        {ruler.segments.map((segment) => (
          <span
            key={`${segment.from}-${segment.to}`}
            data-holds={segment.holds ? 'true' : undefined}
            className={cn(
              'absolute inset-y-0 border-x border-background first:rounded-l-full last:rounded-r-full',
              segment.holds ? 'bg-success' : 'bg-muted'
            )}
            style={{ left: `${segment.from}%`, width: `${Math.max(0, segment.to - segment.from)}%` }}
          />
        ))}
        {ruler.ticks.map((tick) => (
          <span
            key={tick.value}
            aria-hidden="true"
            className="absolute -bottom-4 -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted-foreground"
            style={{ left: `${tick.at}%` }}
          >
            {format(tick.value)}
          </span>
        ))}
        <span
          data-testid="ruler-pin"
          aria-hidden="true"
          className="absolute -top-6 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${Math.min(100, Math.max(0, ruler.pin))}%` }}
        >
          <span className="card-meta whitespace-nowrap rounded bg-foreground px-1 font-semibold text-background tabular-nums">{valueText}</span>
          <span className="h-4 w-0.5 bg-foreground" />
        </span>
      </div>
      <div aria-hidden="true" className="relative mx-2 mt-4 h-4">
        {ruler.segments.map((segment) => (
          <span
            key={`${segment.from}-${segment.label}`}
            className={cn(
              'card-meta absolute truncate text-center',
              segment.holds ? 'font-medium text-success' : 'text-muted-foreground'
            )}
            style={{ left: `${segment.from}%`, width: `${Math.max(0, segment.to - segment.from)}%` }}
          >
            {segment.label}
          </span>
        ))}
      </div>
      {note && <figcaption className="card-caption text-foreground">{note}</figcaption>}
    </figure>
  )
}

export const PrefillButton: FC<{ label: string; title: string; onClick: () => void; ariaLabel?: string }> = ({
  label,
  title,
  onClick,
  ariaLabel,
}) => (
  <button
    type="button"
    data-testid="prefill-button"
    title={title}
    aria-label={ariaLabel}
    onClick={onClick}
    className={cn(
      'inline-flex h-6 shrink-0 items-center gap-1 rounded-control bg-card px-2 text-[11px] font-medium text-muted-foreground shadow-xs',
      'transition-colors duration-quick ease-out motion-reduce:transition-none hover:bg-accent hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-11 pointer-coarse:px-3 print:hidden'
    )}
  >
    <ListPlus aria-hidden="true" className="size-3 shrink-0" />
    <span className="whitespace-nowrap">{label}</span>
  </button>
)

export const RoleChip: FC<{ children: ReactNode }> = ({ children }) => (
  <Chip size="sm" variant="secondary" className={cellChipClass}>
    {children}
  </Chip>
)

export const NotFoundFrame: FC<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="not-found" className="my-4 @container break-inside-avoid">
    <div className="grid gap-2 @[40rem]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,0.9fr)]">{children}</div>
  </div>
)

export const NotFoundPane: FC<{ label: string; pane: string; children: ReactNode }> = ({ label, pane, children }) => (
  <section
    data-pane={pane}
    className={cn(
      'flex min-w-0 flex-col gap-1.5 rounded-surface px-3.5 py-3 text-sm [&_figure]:my-0 [&_p:last-child]:mb-0',
      pane === 'rule' ? 'bg-card ring-1 ring-border' : 'bg-muted/40'
    )}
  >
    <SectionLabel as="h4">{label}</SectionLabel>
    {children}
  </section>
)

export const SearchedList: FC<{ items: readonly { title: string; detail?: string }[]; more: number }> = ({ items, more }) => {
  const t = useTranslations(commonCopy)
  if (items.length === 0) return <p className="card-caption text-muted-foreground">{t('markdown.notFound.nothingRecorded')}</p>
  return (
    <ul className="flex list-none flex-col gap-1 pl-0" data-testid="searched-list">
      {items.map((item) => (
        <li key={`${item.title}-${item.detail ?? ''}`} className="card-caption min-w-0 break-words text-foreground">
          {item.title}
          {item.detail && <span className="text-muted-foreground"> · {item.detail}</span>}
        </li>
      ))}
      {more > 0 && <li className="card-meta text-muted-foreground">{t('markdown.notFound.more', { count: more })}</li>}
    </ul>
  )
}

export const SubsumptionFrame: FC<{ children: ReactNode }> = ({ children }) => (
  <ol data-testid="subsumption" className="my-4 flex list-none flex-col pl-0 break-inside-avoid">
    {children}
  </ol>
)

export const SubsumptionStep: FC<{
  label: string
  part: string
  tone?: StatusTone
  statusWord?: string
  last: boolean
  children: ReactNode
}> = ({ label, part, tone, statusWord, last, children }) => (
  <li data-part={part} className="grid grid-cols-[minmax(0,1fr)] gap-1 @container">
    <div className="grid gap-1 @[34rem]:grid-cols-[8rem_minmax(0,1fr)] @[34rem]:gap-4">
      <span className="flex items-center gap-2 @[34rem]:items-start @[34rem]:pt-1">
        <SectionLabel as="span">{label}</SectionLabel>
        {tone && statusWord && (
          <Chip size="sm" variant={tone} data-testid="subsumption-status">
            {statusWord}
          </Chip>
        )}
      </span>
      <div
        className={cn(
          'min-w-0 text-answer [&_figure]:my-0 [&_p:last-child]:mb-0 [&_ul]:mb-0',
          part === 'result' && 'font-medium text-foreground'
        )}
      >
        {children}
      </div>
    </div>
    {!last && <ArrowDown aria-hidden="true" className="my-1 size-3.5 text-muted-foreground @[34rem]:ml-[8.5rem]" />}
  </li>
)

export const QuoteStampLine: FC<{ verbatim: boolean; number?: number; locus?: string; action?: ReactNode }> = ({
  verbatim,
  number,
  locus,
  action,
}) => {
  const t = useTranslations(commonCopy)
  return (
    <p data-testid="quote-stamp" data-status={verbatim ? 'verbatim' : 'not_found'} className="flex flex-wrap items-center gap-1.5 pl-4">
      <Chip size="sm" variant={verbatim ? 'success' : 'warning'}>
        {verbatim ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
        {verbatim
          ? number !== undefined
            ? t('markdown.stamp.verbatimNumbered', { n: number })
            : t('markdown.stamp.verbatim')
          : t('markdown.stamp.notFound')}
      </Chip>
      {locus && <span className="card-meta text-muted-foreground">{locus}</span>}
      {action}
    </p>
  )
}

export const OpenPassageButton: FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const t = useTranslations(commonCopy)
  return (
    <button
      type="button"
      data-testid="open-passage"
      onClick={onOpen}
      className="card-meta inline-flex items-center gap-1 rounded text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 touch-target print:hidden"
    >
      <ExternalLink aria-hidden="true" className="size-3" />
      {t('markdown.stamp.open')}
    </button>
  )
}
