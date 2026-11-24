'use client'

import type { ExtraProps } from 'react-markdown'
import { Chip } from '@/components/ui/chip'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { PassedCheck, tableClass, tableFrameClass, tableRowClass, tableVariant, useOutcomeLabel } from './answer-atoms'
import { useCaseMarks } from './case-marks'
import { CasesScope, hasCases } from './project-binding'
import { useMarkdownStreamState } from './render-state-context'
import { statusTone } from './status-marks'
import { parseTally } from './table-shape'
import { CHIP_ENTER } from './table-cell-renderers'

export function MarkdownTable({ children, node }: React.ComponentPropsWithoutRef<'table'> & ExtraProps) {
  const t = useTranslations(commonCopy)
  const tally = parseTally(node?.properties?.dataTally)
  const stackValue = node?.properties?.dataStack
  const stack = stackValue === 'true' || stackValue === 'always' ? stackValue : undefined
  const variant = tableVariant(node?.properties?.dataVariant)
  const outcomeLabel = useOutcomeLabel()
  const { streaming, streamedHere } = useMarkdownStreamState()
  const passed =
    node?.properties?.dataCollapsed === 'true' && !streaming && !streamedHere ? Number(node.properties.dataPassCount) : 0
  const reserve = node?.properties?.dataTallyReserve
  const reserved = tally.length === 0 && (reserve === 'true' || (reserve === 'closed' && streamedHere))
  const frame = (
    <div className={tableFrameClass(variant)} data-variant={variant === 'plain' ? undefined : variant}>
      {tally.length > 0 && !passed && (
        <p
          className={`flex flex-wrap items-center gap-1.5${streamedHere ? ` ${CHIP_ENTER}` : ''}`}
          data-testid="status-tally"
        >
          <span className="sr-only">{t('markdown.statusTally')}: </span>
          {tally.map(([word, count]) => (
            <Chip key={word} size="sm" variant={outcomeTone(word) ?? 'muted'}>
              <span className="font-medium tabular-nums">{count}</span> {outcomeLabel(word, 'tally')}
            </Chip>
          ))}
        </p>
      )}
      {reserved && (
        <p className="invisible flex items-center" aria-hidden="true" data-testid="status-tally-reserve">
          <Chip size="sm" variant="muted">0</Chip>
        </p>
      )}
      <HorizontalScroll className="border-base rounded-control border" aria-label={t('markdown.scrollTable')}>
        <table
          data-stack={stack}
          data-labels={node?.properties?.dataLabels === 'above' ? 'above' : undefined}
          className={tableClass(variant)}
        >
          {children}
        </table>
      </HorizontalScroll>
    </div>
  )
  if (passed > 0) return <PassedCheck passed={passed}>{frame}</PassedCheck>
  return hasCases(node) ? <CasesScope node={node}>{frame}</CasesScope> : frame
}

const outcomeTone = (word: string) =>
  word === '@pass' ? 'success' : word === '@fail' ? 'destructive' : word === '@conflict' ? 'warning' : statusTone(word)

export function MarkdownCaption({ children, node }: React.ComponentPropsWithoutRef<'caption'> & ExtraProps) {
  const t = useTranslations(commonCopy)
  return (
    <caption className="border-base text-muted-foreground border-t px-3 py-2 text-left text-xs">
      {t('markdown.sharedSource', { label: String(node?.properties?.dataLabel ?? '') })}: {children}
    </caption>
  )
}

export function MarkdownRow({ children, node }: React.ComponentPropsWithoutRef<'tr'> & ExtraProps) {
  const { active, muted } = useCaseMarks(node?.properties)
  const conflict = Boolean(node?.properties?.dataConflict)
  return (
    <tr
      data-active={active ? 'true' : undefined}
      data-conflict={conflict ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      className={tableRowClass({ active, muted, conflict })}
    >
      {children}
    </tr>
  )
}
