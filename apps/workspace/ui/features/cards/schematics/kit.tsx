'use client'

import { createContext, type FC, type ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react'
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  FileText,
  Scale,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { AskAboutChip } from '../components/AskAboutChip'
import { CARD_SHELL } from '../components/card-chrome'
import { PdfViewerDialog } from '@/features/knowledge/components/pdf-viewer-dialog'
import { resolveCorpusFileName } from '@/features/knowledge/lib/resolve-corpus-file'
import { useCorpusFiles } from '@/features/knowledge/lib/use-corpus-files'
import { cn } from '@/lib/utils'
import { Quote } from '@/components/ui/quote'
import { declutterLabels } from './declutter'
import type { DimensionCheckData, DimStatus, NormReferenceData, Provenance } from '@/shared/cards/schemas'

export const statusColor = (status: DimStatus): string => {
  switch (status) {
    case 'pass':
      return 'var(--text-color-feedback-success)'
    case 'fail':
      return 'var(--text-color-feedback-danger)'
    case 'warning':
      return 'var(--text-color-feedback-warning)'
    case 'needs_input':
      return 'var(--muted-foreground)'
  }
}

export const statusLabel = (status: DimStatus, t: Translator): string => {
  switch (status) {
    case 'pass':
      return t('cards.kit.status.pass')
    case 'fail':
      return t('cards.kit.status.fail')
    case 'warning':
      return t('cards.kit.status.warning')
    case 'needs_input':
      return t('cards.kit.status.needsInput')
  }
}

const STATUS_ICON: Record<DimStatus, LucideIcon> = {
  pass: CircleCheck,
  fail: CircleX,
  warning: TriangleAlert,
  needs_input: CircleHelp,
}

const STATUS_BADGE_CLASS: Record<DimStatus, string> = {
  pass: 'bg-success-subtle text-success',
  fail: 'bg-danger-subtle text-error',
  warning: 'bg-warning-subtle text-warning',
  needs_input: 'bg-muted text-muted-foreground',
}

const STATUS_RANK: Record<DimStatus, number> = { fail: 3, needs_input: 2, warning: 1, pass: 0 }

export const worstStatus = (statuses: DimStatus[]): DimStatus | null => {
  if (statuses.length === 0) return null
  return statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst))
}

export const missingLabel = (t: Translator): string => t('cards.kit.missingValue')

const numberFormat = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 })

export const fmtNum = (value: number): string => numberFormat.format(value)

export const fmtDim = (value: number | null | undefined, unit: string, t: Translator): string =>
  value == null ? missingLabel(t) : `${fmtNum(value)} ${unit}`

export const fmtComparator = (comparator: '<=' | '>=' | null | undefined): string =>
  comparator === '<=' ? '≤' : comparator === '>=' ? '≥' : ''

export const provenanceLabel = (provenance: Provenance, t: Translator): string => {
  switch (provenance) {
    case 'declared':
      return t('cards.kit.provenance.declared')
    case 'computed':
      return t('cards.kit.provenance.computed')
    case 'inferred':
      return t('cards.kit.provenance.inferred')
  }
}

export const provenanceTitle = (provenance: Provenance, t: Translator): string => {
  switch (provenance) {
    case 'declared':
      return t('cards.kit.provenanceTitle.declared')
    case 'computed':
      return t('cards.kit.provenanceTitle.computed')
    case 'inferred':
      return t('cards.kit.provenanceTitle.inferred')
  }
}

export const fmtTolerance = (tolerance: number | null | undefined, unit: string): string | null => {
  if (tolerance == null || !Number.isFinite(tolerance) || tolerance <= 0) return null
  const magnitude = Math.floor(Math.log10(Math.abs(tolerance)))
  const decimals = Math.min(6, Math.max(0, 1 - magnitude))
  return `±${new Intl.NumberFormat('de-AT', { maximumFractionDigits: decimals }).format(tolerance)} ${unit}`
}

export const fitScale = (realW: number, realH: number, boxW: number, boxH: number): number =>
  Math.min(boxW / Math.max(realW, 1e-6), boxH / Math.max(realH, 1e-6))

interface SvgLabelProps {
  x: number
  y: number
  children: ReactNode
  anchor?: 'start' | 'middle' | 'end'
  fill?: string
  size?: number
  mono?: boolean
  italic?: boolean
  weight?: number
  transform?: string
  halo?: string
}

const CanvasScale = createContext<number | null>(null)

export const MIN_LABEL_PX = 10
export const MAX_LABEL_GROWTH = 2

export const legibleLabelSize = (size: number, scale: number | null): number => {
  if (!scale || scale <= 0 || size * scale >= MIN_LABEL_PX) return size
  return Math.min(MIN_LABEL_PX / scale, size * MAX_LABEL_GROWTH)
}

export const SvgLabel: FC<SvgLabelProps> = ({
  x,
  y,
  children,
  anchor = 'start',
  fill = 'var(--muted-foreground)',
  size = 10,
  mono = false,
  italic = false,
  weight = 500,
  transform,
  halo = 'var(--card)',
}) => {
  const scale = useContext(CanvasScale)
  const drawn = legibleLabelSize(size, scale)
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline="central"
      fontSize={drawn}
      fontWeight={weight}
      fontStyle={italic ? 'italic' : undefined}
      className={mono ? 'font-mono' : 'font-sans'}
      fill={fill}
      stroke={halo}
      strokeWidth={(3 * drawn) / size}
      strokeLinejoin="round"
      transform={transform}
      style={{ paintOrder: 'stroke' }}
    >
      {children}
    </text>
  )
}

interface ExtensionLineProps {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const ExtensionLine: FC<ExtensionLineProps> = ({ x1, y1, x2, y2 }) => (
  <line
    x1={x1}
    y1={y1}
    x2={x2}
    y2={y2}
    stroke="var(--muted-foreground)"
    strokeWidth={0.7}
    opacity={0.55}
  />
)

interface DimensionArrowProps {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  status?: DimStatus | null
  color?: string
  labelOffset?: number
  fontSize?: number
  dashed?: boolean
  horizontalLabel?: boolean
}

export const DimensionArrow: FC<DimensionArrowProps> = ({
  x1,
  y1,
  x2,
  y2,
  label,
  status,
  color,
  labelOffset = -9,
  fontSize = 10,
  dashed,
  horizontalLabel,
}) => {
  const stroke = color ?? (status ? statusColor(status) : 'var(--foreground)')
  const missing = status === 'needs_input'
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const ah = 5.5

  const head = (px: number, py: number, dirX: number, dirY: number): string => {
    const bx = px + dirX * ah
    const by = py + dirY * ah
    const wing = ah * 0.5
    return `M ${bx + nx * wing} ${by + ny * wing} L ${px} ${py} L ${bx - nx * wing} ${by - ny * wing}`
  }

  const mx = (x1 + x2) / 2 + nx * labelOffset
  const my = (y1 + y2) / 2 + ny * labelOffset
  const vertical = Math.abs(ux) < 0.35 && !horizontalLabel
  const transform = vertical ? `rotate(-90 ${mx} ${my})` : undefined

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={1.1}
        strokeDasharray={dashed || missing ? '4 3' : undefined}
      />
      <path
        d={head(x1, y1, ux, uy)}
        stroke={stroke}
        strokeWidth={1.1}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={head(x2, y2, -ux, -uy)}
        stroke={stroke}
        strokeWidth={1.1}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <SvgLabel
        x={mx}
        y={my}
        anchor="middle"
        fill={stroke}
        size={fontSize}
        mono={!missing}
        italic={missing}
        weight={600}
        transform={transform}
      >
        {label}
      </SvgLabel>
    </g>
  )
}

const MAX_CANVAS_SCALE = 1.4

const declutterSvgLabels = (svg: SVGSVGElement, viewW: number): void => {
  const frame = svg.getBoundingClientRect()
  const scale = viewW > 0 ? frame.width / viewW : 0
  const texts = Array.from(svg.querySelectorAll('text'))
  texts.forEach((text) => {
    text.removeAttribute('dx')
    text.removeAttribute('dy')
  })
  if (!(scale > 0)) return
  const live = texts
    .map((text) => ({ text, rect: text.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
  const nudges = declutterLabels(
    live.map(({ text, rect }) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top + rect.height * 0.15,
      bottom: rect.bottom - rect.height * 0.15,
      movable: !text.hasAttribute('transform'),
    })),
    { left: frame.left + 2, right: frame.right - 2 }
  )
  live.forEach(({ text }, index) => {
    const { dx, dy } = nudges[index]
    if (dx !== 0) text.setAttribute('dx', String(dx / scale))
    if (dy !== 0) text.setAttribute('dy', String(dy / scale))
  })
}

interface SchematicCanvasProps {
  viewW: number
  viewH: number
  label: string
  children: ReactNode
}

export const SchematicCanvas: FC<SchematicCanvasProps> = ({ viewW, viewH, label, children }) => {
  const ref = useRef<SVGSVGElement>(null)
  const [scale, setScale] = useState<number | null>(null)
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const update = () => setScale(svg.getBoundingClientRect().width / viewW)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [viewW])
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    const place = () => declutterSvgLabels(svg, viewW)
    place()
    void document.fonts?.ready.then(place)
  })
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${viewW} ${viewH}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      className="block h-auto w-full"
      style={{ maxWidth: Math.round(viewW * MAX_CANVAS_SCALE) }}
    >
      <CanvasScale.Provider value={scale}>{children}</CanvasScale.Provider>
    </svg>
  )
}

interface LimitBarProps {
  check: DimensionCheckData
  className?: string
}

export const LimitBar: FC<LimitBarProps> = ({ check, className }) => {
  const t = useTranslations(chatCopy)
  const { label, value, required, comparator, status } = check
  const unit = check.unit ?? 'cm'
  const max = Math.max(value ?? 0, required ?? 0) * 1.08 || 1
  const valuePct = value != null ? Math.min((value / max) * 100, 100) : 0
  const requiredPct = required != null ? Math.min((required / max) * 100, 100) : null

  const band = check.provenance === 'computed' ? fmtTolerance(check.tolerance, unit) : null
  const tolerance = band != null && check.tolerance != null ? check.tolerance : null
  const bandLowPct = value != null && tolerance != null ? Math.max(((value - tolerance) / max) * 100, 0) : null
  const bandHighPct = value != null && tolerance != null ? Math.min(((value + tolerance) / max) * 100, 100) : null

  const low = value != null && tolerance != null ? value - tolerance : null
  const high = value != null && tolerance != null ? value + tolerance : null
  const straddlesLimit =
    required != null && low != null && high != null
      ? comparator === '<='
        ? low <= required && high > required
        : comparator === '>='
          ? high >= required && low < required
          : false
      : false

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="card-body flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">
          {value == null ? (
            <span className="font-sans italic text-muted-foreground">{missingLabel(t)}</span>
          ) : (
            fmtDim(value, unit, t)
          )}
          {band && <span className="card-meta ml-1 text-muted-foreground">{band}</span>}
          {check.provenance && (
            <span
              className="card-meta ml-1.5 rounded bg-muted px-1 py-px font-sans text-muted-foreground"
              title={provenanceTitle(check.provenance, t)}
            >
              {provenanceLabel(check.provenance, t)}
            </span>
          )}
          {required != null && (
            <span className="text-muted-foreground">
              {' '}
              {fmtComparator(comparator)} {fmtDim(required, unit, t)}
            </span>
          )}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        {value != null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${valuePct}%`, backgroundColor: statusColor(status) }}
          />
        )}
        {bandLowPct != null && bandHighPct != null && (
          <div
            className="absolute inset-y-0 border-x border-foreground/40 bg-foreground/15"
            style={{ left: `${bandLowPct}%`, width: `${Math.max(bandHighPct - bandLowPct, 0.5)}%` }}
            aria-hidden="true"
          />
        )}
        {requiredPct != null && (
          <div
            className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${requiredPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {straddlesLimit && (
        <p className="card-caption leading-snug text-muted-foreground">
          {t('cards.kit.toleranceStraddlesLimit')}
        </p>
      )}
      {status === 'needs_input' && check.missing && (
        <p className="card-caption leading-snug text-muted-foreground">{check.missing}</p>
      )}
    </div>
  )
}

interface DimChecksListProps {
  checks: DimensionCheckData[]
  className?: string
}

export const DimChecksList: FC<DimChecksListProps> = ({ checks, className }) => {
  const t = useTranslations(chatCopy)
  if (checks.length === 0) return null
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {checks.map((check, index) => {
        const Icon = STATUS_ICON[check.status]
        const unit = check.unit ?? 'cm'
        const band = check.provenance === 'computed' ? fmtTolerance(check.tolerance, unit) : null
        return (
          <li key={`${check.label}-${index}`} className="card-body flex flex-col gap-0.5">
            {/* The label WRAPS and is never clipped: it names the dimension, and
                the row that decides a verdict is the row whose name a clip hid
                („Lichteinfall 45° — Gegenüberliegendes Gebäude“). It takes an 8rem
                basis and the free width, so figures sit beside a short label
                like a table row, a long label wraps over several lines, and
                where the box is too narrow for both the figures drop to a line
                of their own, right-aligned. Wrapped by the box, not by a
                breakpoint, because the same legend sits in the answer column,
                a side panel and a phone. */}
            <div className="flex items-start gap-2">
              <Icon
                className="mt-[3px] size-3.5 shrink-0"
                style={{ color: statusColor(check.status) }}
                aria-label={statusLabel(check.status, t)}
              />
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="min-w-0 flex-1 basis-[8rem] text-muted-foreground [overflow-wrap:anywhere]">
                  {check.label}
                </span>
                <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-2">
                  {check.value == null ? (
                    <span className="italic text-muted-foreground">{missingLabel(t)}</span>
                  ) : (
                    <span className="font-mono text-foreground">
                      {fmtDim(check.value, unit, t)}
                      {band && <span className="card-meta ml-1 text-muted-foreground">{band}</span>}
                    </span>
                  )}
                  {check.provenance && (
                    <span
                      className="card-meta shrink-0 rounded bg-muted px-1 py-px text-muted-foreground"
                      title={provenanceTitle(check.provenance, t)}
                    >
                      {provenanceLabel(check.provenance, t)}
                    </span>
                  )}
                  {check.required != null && (
                    <span className="font-mono text-muted-foreground">
                      {fmtComparator(check.comparator)} {fmtDim(check.required, unit, t)}
                    </span>
                  )}
                </span>
              </div>
            </div>
            {check.status === 'needs_input' && check.missing && (
              <p className="card-caption pl-5.5 leading-snug text-muted-foreground">{check.missing}</p>
            )}
            {/* The remedy is stated; the question about it is one click away.
                Everything the sentence needs is already in this row, so the
                chip builds it and puts it in the composer — no turn is fired
                and nothing is fetched. */}
            {check.status === 'needs_input' && (
              <AskAboutChip
                className="ml-5.5 mt-0.5 self-start"
                subject={check.label}
                missing={check.missing}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

interface NormRefFooterProps {
  reference: NormReferenceData | null | undefined
  bare?: boolean
}

export const NormRefFooter: FC<NormRefFooterProps> = ({ reference, bare = false }) => {
  const tKnowledge = useTranslations(knowledgeCopy)
  const corpusFiles = useCorpusFiles()
  const [viewerOpen, setViewerOpen] = useState(false)
  if (!reference?.document) return null
  const corpusFileName = resolveCorpusFileName(reference.document, corpusFiles)
  return (
    <div className={bare ? 'flex flex-col gap-2' : 'flex flex-col gap-2 border-t pt-3'}>
      <div className="card-caption flex flex-wrap items-center gap-2 text-muted-foreground">
        <Scale className="size-3.5" aria-hidden="true" />
        <span className="font-medium text-foreground">{reference.document}</span>
        {reference.section && (
          <Badge variant="outline" className="card-meta font-mono font-normal">
            {reference.section}
          </Badge>
        )}
        {reference.edition && <span>{reference.edition}</span>}
        {corpusFileName && (
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            className="inline-flex items-center gap-1 font-medium text-primary transition-opacity duration-quick ease-out hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <FileText className="size-3.5" aria-hidden="true" />
            {tKnowledge('viewer.view')}
          </button>
        )}
      </div>
      {reference.excerpt && (
        <Quote className="card-caption max-w-prose">{reference.excerpt}</Quote>
      )}
      {corpusFileName && viewerOpen && (
        <PdfViewerDialog open onOpenChange={setViewerOpen} fileName={corpusFileName} title={reference.document} />
      )}
    </div>
  )
}

interface StatusBadgeProps {
  status: DimStatus
}

export const StatusBadge: FC<StatusBadgeProps> = ({ status }) => {
  const t = useTranslations(chatCopy)
  const Icon = STATUS_ICON[status]
  return (
    <span
      className={cn(
        'card-meta inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5',
        STATUS_BADGE_CLASS[status]
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {statusLabel(status, t)}
    </span>
  )
}

interface SchematicCardProps {
  icon: LucideIcon
  eyebrow?: string
  title: string
  verdict?: DimStatus | null
  verdictNote?: ReactNode
  note?: string | null
  reference?: NormReferenceData | null
  children: ReactNode
}

export const SchematicCard: FC<SchematicCardProps> = ({
  icon: Icon,
  eyebrow,
  title,
  verdict,
  verdictNote,
  note,
  reference,
  children,
}) => {
  const t = useTranslations(chatCopy)
  return (
    <Card className={cn(CARD_SHELL, 'gap-3 p-5')}>
      {/* The eyebrow never wraps; where the pills do not fit beside it, they
          move to a line of their own as one row, right-aligned, rather than
          stacking one under the other beside a broken eyebrow. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="card-eyebrow flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
          <Icon className="size-3.5" aria-hidden="true" />
          <span>{eyebrow ?? t('cards.kit.eyebrow')}</span>
        </div>
        {(verdict || verdictNote) && (
          <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap">
            {verdictNote}
            {verdict && <StatusBadge status={verdict} />}
          </span>
        )}
      </div>

      <p className="card-title text-foreground">{title}</p>

      {children}

      {note && <p className="card-caption max-w-prose text-muted-foreground">{note}</p>}

      <NormRefFooter reference={reference} />
    </Card>
  )
}
