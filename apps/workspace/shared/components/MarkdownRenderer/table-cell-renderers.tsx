'use client'

import type { ReactNode } from 'react'
import type { ExtraProps } from 'react-markdown'
import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { useRowActionRenderer } from './answer-block-context'
import { cellChipClass, dataCellClass, headerCellClass, MarkChip, RoleChip, useOutcomeLabel, ValueBar } from './answer-atoms'
import { TaskCellContent } from './directive-blocks'
import { TASK_CELL } from './directive-shape'
import { useCasesDecision } from './project-binding'
import { useMarkdownStreamState } from './render-state-context'
import { isStatusTone } from './status-marks'
import { textOf } from './table-shape'
import { getTextFromChildren } from './utils'

function cellAlignClass(
  align: string | undefined,
  style: React.CSSProperties | undefined
): string | undefined {
  const alignment = style?.textAlign ?? align
  if (alignment === 'center') return 'text-center'
  if (alignment === 'right') return 'text-right'
  return undefined
}

export const CHIP_ENTER = 'animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none'

export function MarkdownHeaderCell({ children, align, style, node }: React.ComponentPropsWithoutRef<'th'> & ExtraProps) {
  const t = useTranslations(commonCopy)
  const recommended = Boolean(node?.properties?.dataRecommended)
  if (node?.properties?.dataTaskHead) {
    return (
      <th className="w-0 px-2 py-2 print:hidden">
        <span className="sr-only">{t('markdown.actions.column')}</span>
      </th>
    )
  }
  return (
    <th
      data-recommended={recommended ? 'true' : undefined}
      className={headerCellClass({
        align: cellAlignClass(align, style) ?? (node?.properties?.dataNumeric ? 'text-right' : 'text-left'),
        recommended,
      })}
    >
      {children}
      {recommended && <MarkChip>{t('markdown.recommended')}</MarkChip>}
    </th>
  )
}

export function MarkdownCell({ children, align, style, node }: React.ComponentPropsWithoutRef<'td'> & ExtraProps) {
  const properties = node?.properties ?? {}
  const t = useTranslations(commonCopy)
  const cases = useCasesDecision()
  const status = properties.dataStatus
  const tone = isStatusTone(status) ? status : null
  const label = properties.dataLabel
  const renderRowAction = useRowActionRenderer()
  const bar = valueBarOf(properties)
  const ask = typeof properties.dataAsk === 'string' ? properties.dataAsk : null
  const outcome = typeof properties.dataOutcome === 'string' ? properties.dataOutcome : null
  const outcomeLabel = useOutcomeLabel()
  const { streaming } = useMarkdownStreamState()
  if (properties.dataCell === TASK_CELL) {
    return (
      <td className="w-0 whitespace-nowrap px-2 py-1.5 align-top print:hidden" data-cell={TASK_CELL}>
        <TaskCellContent node={node} />
      </td>
    )
  }
  const caseIndex = properties.dataCaseIndex
  const decided = cases !== null && caseIndex !== undefined
  const holds = decided && Number(caseIndex) === cases.match
  let content: ReactNode = children
  if (decided && properties.dataCaseStatus) {
    const claimed = Boolean(properties.dataCaseClaim)
    content = holds ? (
      <Chip size="sm" variant="success" data-testid="status-mark" data-tone="success" data-case="holds" className={cellChipClass}>
        {t('markdown.caseApplies')}
      </Chip>
    ) : claimed ? (
      <Chip
        size="sm"
        variant="muted"
        data-testid="status-mark"
        data-tone="muted"
        data-case="overruled"
        title={t('markdown.caseOverruled', { word: getTextFromChildren(children) })}
        className={cellChipClass}
      >
        {t('markdown.caseNotApplies')}
      </Chip>
    ) : tone ? (
      <Chip size="sm" variant="muted" data-testid="status-mark" data-tone="muted" className={cellChipClass}>
        {children}
      </Chip>
    ) : (
      children
    )
  } else if (tone) {
    content = (
      <Chip
        size="sm"
        variant={tone}
        data-testid="status-mark"
        data-tone={tone}
        data-outcome={outcome ?? undefined}
        title={outcome ? getTextFromChildren(children) : undefined}
        className={streaming ? `${cellChipClass} ${CHIP_ENTER}` : cellChipClass}
      >
        {outcome ? outcomeLabel(outcome, 'cell') : children}
      </Chip>
    )
  } else if (properties.dataRole) {
    content = <RoleChip>{children}</RoleChip>
  }
  return (
    <td
      data-label={typeof label === 'string' ? label : undefined}
      data-numeric={properties.dataNumeric ? 'true' : undefined}
      className={dataCellClass({
        align: cellAlignClass(align, style) ?? (properties.dataNumeric ? 'text-right' : undefined),
        recommended: Boolean(properties.dataRecommended),
      })}
    >
      {content}
      {node && isBlankCell(node) && BLANK_CELL_LINE}
      {holds && properties.dataCaseLead && <MarkChip>{t('markdown.caseApplies')}</MarkChip>}
      {bar && <ValueBar {...bar} valueText={getTextFromChildren(children)} />}
      {ask !== null && renderRowAction && (
        <span className="ml-1.5 inline-flex align-middle print:hidden">
          {renderRowAction({ subject: ask, detail: String(properties.dataAskDetail ?? '') })}
        </span>
      )}
    </td>
  )
}

const isBlankCell = (node: NonNullable<ExtraProps['node']>): boolean => node.children.every((child) => textOf(child).trim() === '')

const BLANK_CELL_LINE = '\u200B'

function valueBarOf(properties: Record<string, unknown>) {
  const value = Number(properties.dataBarValue)
  const limit = Number(properties.dataBarLimit)
  if (properties.dataBarValue === undefined || !Number.isFinite(value) || !Number.isFinite(limit)) return null
  const bound: 'min' | 'max' = properties.dataBarBound === 'min' ? 'min' : 'max'
  const limitText = typeof properties.dataBarLimitText === 'string' ? properties.dataBarLimitText : String(limit)
  return { value, limit, bound, pass: properties.dataBarPass === 'true', limitText }
}
