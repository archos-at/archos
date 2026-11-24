'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { AlertTriangle, Bot, MessageSquare, Workflow, Wrench, type LucideIcon } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { cn } from '@/lib/utils'
import { formatSpanDuration } from './agent-profiler-format'
import type { SpanKind, SpanNodeDto, TurnDto } from './agent-profiler-types'

const INDENT_PX = 12
const MAX_INDENT_DEPTH = 4

const KIND_STYLE: Record<SpanKind, { icon: LucideIcon; color: string }> = {
  turn: {
    icon: MessageSquare,
    color: 'color-mix(in oklab, var(--muted-foreground) 45%, transparent)',
  },
  node: { icon: Workflow, color: 'var(--chart-series-1)' },
  llm: { icon: Bot, color: 'var(--chart-series-3)' },
  tool: { icon: Wrench, color: 'var(--chart-series-2)' },
}
const KIND_ORDER: SpanKind[] = ['turn', 'node', 'llm', 'tool']

interface WaterfallRow {
  node: SpanNodeDto
  depth: number
  offsetMs: number
}

function flattenWithOffset(root: SpanNodeDto): WaterfallRow[] {
  const turnStart = Date.parse(root.startedAt)
  const rows: WaterfallRow[] = []
  const walk = (node: SpanNodeDto, depth: number): void => {
    rows.push({ node, depth, offsetMs: Date.parse(node.startedAt) - turnStart })
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return rows
}

export function barGeometry(
  offsetMs: number,
  durationMs: number,
  totalMs: number
): { left: number; width: number } {
  const total = Math.max(totalMs, 1)
  const left = Math.min(Math.max((offsetMs / total) * 100, 0), 98.5)
  const width = Math.min(Math.max((durationMs / total) * 100, 1.5), 100 - left)
  return { left, width }
}

export function KindLegend(): JSX.Element {
  const t = useTranslations(platformCopy)
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label={t('profiler.legendAria')}>
      {KIND_ORDER.map((kind) => {
        const { icon: Icon, color } = KIND_STYLE[kind]
        return (
          <li key={kind} className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {t(`profiler.kinds.${kind}`)}
          </li>
        )
      })}
    </ul>
  )
}

export function TurnWaterfall({ turn, locale }: { turn: TurnDto; locale: string }): JSX.Element {
  const t = useTranslations(platformCopy)
  if (!turn.root) return <p className="text-muted-foreground text-sm">{t('profiler.noSpans')}</p>
  const synthetic = turn.root.metadata?.synthetic === true
  const rows = flattenWithOffset(turn.root)
  const nameOf = (node: SpanNodeDto): string =>
    synthetic && node === turn.root ? t('profiler.syntheticRoot') : node.name
  return (
    <div className="flex flex-col gap-2">
      {synthetic ? (
        <p className="text-muted-foreground text-xs">
          {t('profiler.noRoot', { count: turn.spanCount })}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2 sm:gap-1.5">
        {rows.map(({ node, depth, offsetMs }) => {
          const { icon: Icon, color } = KIND_STYLE[node.kind]
          const { left, width } = barGeometry(offsetMs, node.durationMs, turn.durationMs)
          const failed = node.status === 'error'
          const failure = failed
            ? node.errorMessage
              ? t('profiler.spanFailed', { message: node.errorMessage })
              : t('profiler.spanFailedUnknown')
            : null
          const duration = formatSpanDuration(node.durationMs, locale)
          const label = `${t(`profiler.kinds.${node.kind}`)}: ${nameOf(node)}, ${duration}${failure ? `. ${failure}` : ''}`
          return (
            <li
              key={node.spanId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4.5rem]"
              title={label}
            >
              <span
                className="flex min-w-0 items-center gap-1.5"
                style={{ paddingLeft: Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX }}
              >
                <Icon className="size-3.5 shrink-0" style={{ color }} aria-hidden />
                <span className="sr-only">{t(`profiler.kinds.${node.kind}`)}: </span>
                <span className={cn('truncate', failed ? 'text-error' : 'text-foreground/80')}>
                  {nameOf(node)}
                </span>
                {failed ? (
                  <AlertTriangle className="text-error size-3.5 shrink-0" aria-hidden />
                ) : null}
              </span>
              <span className="text-muted-foreground text-right tabular-nums sm:order-last">
                {duration}
              </span>
              <span
                className="bg-muted relative col-span-2 h-3 rounded-sm sm:col-span-1 sm:h-4"
                aria-hidden
              >
                <span
                  className={cn(
                    'absolute inset-y-0 rounded-sm',
                    failed && 'ring-destructive ring-offset-card ring-2 ring-offset-1'
                  )}
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }}
                />
              </span>
              {failure ? <SpanFailure text={failure} /> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SpanFailure({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className={cn(
        'text-error col-span-full text-left break-words sm:order-[10000]',
        'pointer-coarse:py-3.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        !open && 'line-clamp-2'
      )}
      data-testid="span-failure"
    >
      {text}
    </button>
  )
}
