'use client'

import { Circle, CircleCheck, TableOfContents } from 'lucide-react'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { type FC, type ReactNode, createContext, memo, useContext, useMemo, useState } from 'react'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import ReactMarkdown, { type Components, type ExtraProps, type Options } from 'react-markdown'
import type { PluggableList } from 'unified'
import rehypeKatex from 'rehype-katex'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { CodeBlock } from '@/shared/components/CodeBlock'
import { Chip } from '@/components/ui/chip'
import type { MarkdownRendererProps } from './types'
import { scrollToAnchor, useInPageAnchorRenderer } from './anchor-context'
import { MARKDOWN_SLOT_TAG, useMarkdownSlotRenderer } from './slot-context'
import { isInternalHref, useInternalLinkRenderer } from './internal-link-context'
import { markdownHeadings } from './headings'
import { useOpenOutline } from './outline-context'
import { rehypeBindWords } from './bind-words'
import {
  type MarkdownBlock,
  rehypeBlockSeparator,
  remarkBlockContinues,
  splitMarkdownBlocks,
} from './markdown-blocks'
import { getLanguageFromClassName, headingAnchorId } from './utils'
import { DiagramFence, diagramFenceKind } from './diagram-fence'
import { isStatusTone, statusTone } from './status-marks'
import { parseTally, rehypeTableShape, textOf } from './table-shape'
import { isDelimiterRow } from '@/lib/text/markdown-table'
import { normalizeDirectiveFences } from '@/lib/text/answer-directives'
import {
  ANSWER_BLOCK_LABEL_TAG,
  ANSWER_BLOCK_TAG,
  ANSWER_ENERGY_TAG,
  ANSWER_MARKER_TAG,
  ANSWER_PROJECT_TAG,
  remarkAnswerDirectives,
} from './directives'
import {
  BLOCK_BODY_TAG,
  COMPARE_LABEL_TAG,
  COMPARE_ROW_TAG,
  COMPARE_STACK_TAG,
  COMPARE_TITLE_TAG,
  COMPARE_VALUE_TAG,
  COMPARE_VARIANT_TAG,
  FIGURE_LABEL_TAG,
  FIGURE_LIMIT_TAG,
  FIGURE_TAG,
  FIGURE_VALUE_TAG,
  FIGURES_TAG,
  NOT_FOUND_TAG,
  PANE_TAG,
  STEP_DETAIL_TAG,
  STEP_DUE_TAG,
  STEP_HEAD_TAG,
  SUBSUMPTION_PART_TAG,
  SUBSUMPTION_TAG,
  TASK_CELL,
  rehypeDirectiveShape,
} from './directive-shape'
import {
  AnswerBlock,
  AnswerBlockBody,
  AnswerBlockLabel,
  AnswerBlockquote,
  AnswerEnergy,
  AnswerMarker,
  CompareLabel,
  CompareRow,
  CompareStack,
  CompareValue,
  CompareVariant,
  Figure,
  Figures,
  NotFound,
  Pane,
  StepItem,
  StepPart,
  Subsumption,
  TaskCellContent,
} from './directive-blocks'
import { AnswerProject, CasesScope, hasCases, useCasesDecision } from './project-binding'
import {
  ListCase,
  MarkChip,
  PassedCheck,
  RoleChip,
  cellChipClass,
  useOutcomeLabel,
  StepList,
  ValueBar,
  dataCellClass,
  headerCellClass,
  tableClass,
  tableFrameClass,
  tableRowClass,
  tableVariant,
} from './answer-atoms'
import { useRowActionRenderer } from './answer-block-context'
import { MarkdownCaret, STREAMING_CARET_TAG, StreamingCaretProvider, rehypeStreamingCaret } from './streaming-caret'

const KATEX_OPTIONS = { throwOnError: false, maxSize: 20, maxExpand: 200 }
const REHYPE_PLUGINS: PluggableList = [[rehypeKatex, KATEX_OPTIONS], rehypeTableShape, rehypeDirectiveShape, rehypeBindWords]
const REHYPE_PLUGINS_OPEN: PluggableList = [
  [rehypeKatex, KATEX_OPTIONS],
  [rehypeTableShape, { openTail: true }],
  [rehypeDirectiveShape, { openTail: true }],
  rehypeBindWords,
]

function cellAlignClass(
  align: string | undefined,
  style: React.CSSProperties | undefined
): string | undefined {
  const alignment = style?.textAlign ?? align
  if (alignment === 'center') return 'text-center'
  if (alignment === 'right') return 'text-right'
  return undefined
}

function getTextFromChildren(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getTextFromChildren).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return getTextFromChildren((node as React.ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ''
}

export function isOpenFence(lines: readonly string[], start: number, end: number): boolean {
  const last = lines.length
  if (end < last) return false
  const opener = lines[start - 1]?.match(/(`{3,}|~{3,})/)?.[1]
  if (!opener || end <= start) return true
  const closer = lines[end - 1]?.match(/^[\s>]*(`{3,}|~{3,})\s*$/)?.[1]
  return !(closer && closer[0] === opener[0] && closer.length >= opener.length)
}

export function stabilizeStreamingMarkdown(raw: string): string {
  let content = raw

  const lines = content.split('\n')
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  let start = end
  while (start > 0 && lines[start - 1].trim().startsWith('|')) start--
  if (end - start >= 1) {
    const tableLines = lines.slice(start, end)
    const hasDelimiterRow = tableLines.some(isDelimiterRow)
    if (!hasDelimiterRow) {
      for (let i = start; i < end; i++) {
        lines[i] = lines[i].replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
      }
      content = lines.join('\n')
    }
  }

  return closeOpenBold(holdHalfDirective(content))
}

export function holdHalfDirective(content: string): string {
  const cut = content.lastIndexOf('\n') + 1
  const line = content.slice(cut)
  const fences = content.match(/^[ \t]*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) return content
  if (/^\s*:{2,}$/.test(line)) return openContainers(content.slice(0, cut)) > 0 && /:{3}/.test(line) ? content : content.slice(0, cut)
  if (/^\s*:{3,}[A-Za-z][\w-]*\[[^\]]*$/.test(line)) return content.slice(0, cut)
  if (/^\s*:{3,}[A-Za-z][\w-]*(?:\[[^\]]*\])?\{[^}]*$/.test(line)) return content.slice(0, cut)
  const from = line.lastIndexOf(']') + 1
  const inline = /(^|[^\w:]):[A-Za-z][\w-]{0,63}\[[^\]]*$/.exec(line.slice(from))
  return inline ? content.slice(0, cut + from + inline.index + inline[1].length) : content
}

function openContainers(content: string): number {
  let open = 0
  for (const line of content.split('\n')) {
    if (/^\s*:{3,}[A-Za-z]/.test(line)) open += 1
    else if (/^\s*:{3,}\s*$/.test(line) && open > 0) open -= 1
  }
  return open
}

function closeOpenBold(content: string): string {
  const fences = content.match(/^[ \t]*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) return content
  const line = content.slice(content.lastIndexOf('\n') + 1)
  if (line.trimStart().startsWith('|')) return content
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return content
  if ((line.match(/\*\*/g)?.length ?? 0) % 2 === 0) return content
  const trimmed = content.trimEnd()
  if (trimmed.endsWith('**')) return content
  return `${trimmed}**`
}

interface MarkdownRenderState {
  compact: boolean
  headingIds: ReadonlyMap<number, string>
  streamingLines: readonly string[] | null
}

const NO_HEADINGS: ReadonlyMap<number, string> = new Map()

const MarkdownRenderStateContext = createContext<MarkdownRenderState>({
  compact: false,
  headingIds: NO_HEADINGS,
  streamingLines: null,
})

const useMarkdownRenderState = (): MarkdownRenderState => useContext(MarkdownRenderStateContext)

interface MarkdownStreamState {
  streaming: boolean
  streamedHere: boolean
}

const MarkdownStreamStateContext = createContext<MarkdownStreamState>({ streaming: false, streamedHere: false })

const useMarkdownStreamState = (): MarkdownStreamState => useContext(MarkdownStreamStateContext)

function useHeadingId(node: ExtraProps['node'], children: ReactNode): string {
  const { headingIds } = useMarkdownRenderState()
  const line = node?.position?.start.line
  const assigned = line === undefined ? undefined : headingIds.get(line)
  return assigned ?? headingAnchorId(getTextFromChildren(children))
}

function MarkdownSlot({ index }: { index?: string }) {
  const renderSlot = useMarkdownSlotRenderer()
  const position = Number(index)
  if (!renderSlot || !Number.isInteger(position)) return null
  return <>{renderSlot(position)}</>
}

function MarkdownCode({
  children,
  className: codeClassName,
  node,
  ...props
}: React.ComponentPropsWithoutRef<'code'> & ExtraProps) {
  const { streamingLines } = useMarkdownRenderState()
  const rawContent = String(children)
  const isBlock = codeClassName?.startsWith('language-') || rawContent.includes('\n')
  const codeContent = rawContent.replace(/\n$/, '')

  if (!isBlock) {
    return (
      <code
        className="bg-muted text-foreground rounded-inline px-1.5 py-0.5 font-mono text-[0.875em]"
        {...props}
      >
        {children}
      </code>
    )
  }

  const drawing = diagramFenceKind(codeClassName, codeContent)
  if (drawing) {
    const at = node?.position
    const stillWriting = streamingLines !== null && at !== undefined && isOpenFence(streamingLines, at.start.line, at.end.line)
    return <DiagramFence kind={drawing} source={codeContent} isStreaming={stillWriting} />
  }

  const lineCount = codeContent.split('\n').length
  return (
    <CodeBlock
      value={codeContent}
      language={getLanguageFromClassName(codeClassName)}
      collapsible={lineCount > 15}
      maxLines={15}
    />
  )
}

type HeadingProps = React.ComponentPropsWithoutRef<'h1'> & ExtraProps

function MarkdownH1({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h1
      id={id}
      className="text-foreground mb-3 mt-8 block scroll-mt-4 text-xl font-medium"
    >
      {children}
    </h1>
  )
}

function MarkdownH2({ children, node, id: givenId, className: givenClass }: HeadingProps) {
  const derived = useHeadingId(node, children)
  const openOutline = useOpenOutline()
  const t = useTranslations(commonCopy)
  return (
    <h2
      id={givenId ?? derived}
      className={`mb-3 mt-8 block scroll-mt-4 text-lg font-medium text-foreground hyphens-manual${givenClass ? ` ${givenClass}` : ''}`}
    >
      {openOutline ? (
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">{children}</span>
          <button
            type="button"
            onClick={openOutline}
            data-testid="outline-heading-button"
            aria-label={t('markdown.outlineOpen')}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 -my-2.5 hidden size-11 shrink-0 items-center justify-center rounded-control outline-none focus-visible:ring-2 pointer-coarse:inline-flex print:hidden"
          >
            <TableOfContents className="size-4" aria-hidden />
          </button>
        </span>
      ) : (
        children
      )}
    </h2>
  )
}

function MarkdownH3({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h3
      id={id}
      className="text-foreground mb-2 mt-6 block scroll-mt-4 text-base font-medium hyphens-manual"
    >
      {children}
    </h3>
  )
}

function MarkdownH4({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h4 id={id} className="text-foreground mb-1 mt-3 block scroll-mt-4 text-sm font-medium">
      {children}
    </h4>
  )
}

function MarkdownH5({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h5 id={id} className="text-foreground mb-1 mt-3 block scroll-mt-4 text-sm font-medium">
      {children}
    </h5>
  )
}

function MarkdownH6({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h6 id={id} className="text-subtle mb-1 mt-3 block scroll-mt-4 text-sm font-medium">
      {children}
    </h6>
  )
}

function MarkdownParagraph({ children }: React.ComponentPropsWithoutRef<'p'>) {
  const { compact } = useMarkdownRenderState()
  return (
    <p className={`text-foreground mb-4 block max-w-[72ch] ${compact ? 'text-sm leading-relaxed' : 'text-answer'}`}>
      {children}
    </p>
  )
}

function MarkdownListItem({ children, id, node }: React.ComponentPropsWithoutRef<'li'> & ExtraProps) {
  const { compact } = useMarkdownRenderState()
  const { active, muted } = useCaseMarks(node?.properties)
  const t = useTranslations(commonCopy)
  const decided = useCasesDecision() !== null && node?.properties?.dataCaseIndex !== undefined
  if (node?.properties?.dataPhase) return <StepItem node={node}>{children}</StepItem>
  if (active || muted) {
    return (
      <ListCase id={id} active={active} muted={muted} compact={compact}>
        {children}
        {active && decided && <MarkChip>{t('markdown.caseApplies')}</MarkChip>}
      </ListCase>
    )
  }
  return (
    <li id={id} className={`text-foreground ${compact ? 'text-sm' : 'text-answer'}`}>
      {children}
    </li>
  )
}

function useCaseMarks(properties: Record<string, unknown> | undefined): { active: boolean; muted: boolean } {
  const cases = useCasesDecision()
  const index = properties?.dataCaseIndex
  if (cases && index !== undefined) {
    const active = Number(index) === cases.match
    return { active, muted: cases.match >= 0 && !active }
  }
  return { active: Boolean(properties?.dataActive), muted: Boolean(properties?.dataMuted) }
}

function MarkdownTaskMark({ type, checked }: React.ComponentPropsWithoutRef<'input'> & ExtraProps) {
  const t = useTranslations(commonCopy)
  if (type !== 'checkbox') return null
  const Mark = checked ? CircleCheck : Circle
  return (
    <span
      className="mr-2 inline-flex translate-y-[3px] align-top"
      data-testid="task-mark"
      data-done={checked ? 'true' : 'false'}
    >
      <Mark aria-hidden="true" className={checked ? 'text-success size-4' : 'text-muted-foreground size-4'} />
      <span className="sr-only">{checked ? t('markdown.taskDone') : t('markdown.taskOpen')}</span>
    </span>
  )
}

function MarkdownLink({ href, children, node: _node, ...rest }: React.ComponentPropsWithoutRef<'a'> & ExtraProps) {
  const renderInPageAnchor = useInPageAnchorRenderer()
  const renderInternalLink = useInternalLinkRenderer()
  const extra = rest as Record<string, unknown>
  const footnoteRef = extra['data-footnote-ref'] as boolean | undefined
  const footnoteBackref = extra['data-footnote-backref'] as boolean | undefined
  const isFootnote = footnoteRef !== undefined || footnoteBackref !== undefined
  if (href?.startsWith('#')) {
    if (renderInPageAnchor && !isFootnote) {
      return <>{renderInPageAnchor({ href, children })}</>
    }
    return (
      <a
        href={href}
        aria-label={extra['aria-label'] as string | undefined}
        data-footnote-ref={footnoteRef}
        data-footnote-backref={footnoteBackref}
        className="text-brand underline underline-offset-2 hover:opacity-80"
        onClick={(e: React.MouseEvent) => {
          e.preventDefault()
          scrollToAnchor(href.slice(1))
        }}
      >
        {children}
      </a>
    )
  }
  if (isInternalHref(href)) {
    if (renderInternalLink) {
      return <>{renderInternalLink({ href, children })}</>
    }
    return (
      <a href={href} className="text-brand underline underline-offset-2 hover:opacity-80">
        {children}
      </a>
    )
  }
  return (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  )
}

function MarkdownTable({ children, node }: React.ComponentPropsWithoutRef<'table'> & ExtraProps) {
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

const CHIP_ENTER = 'animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none'

const outcomeTone = (word: string) =>
  word === '@pass' ? 'success' : word === '@fail' ? 'destructive' : word === '@conflict' ? 'warning' : statusTone(word)

function MarkdownCaption({ children, node }: React.ComponentPropsWithoutRef<'caption'> & ExtraProps) {
  const t = useTranslations(commonCopy)
  return (
    <caption className="border-base text-muted-foreground border-t px-3 py-2 text-left text-xs">
      {t('markdown.sharedSource', { label: String(node?.properties?.dataLabel ?? '') })}: {children}
    </caption>
  )
}

function MarkdownRow({ children, node }: React.ComponentPropsWithoutRef<'tr'> & ExtraProps) {
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

function MarkdownHeaderCell({ children, align, style, node }: React.ComponentPropsWithoutRef<'th'> & ExtraProps) {
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

function MarkdownCell({ children, align, style, node }: React.ComponentPropsWithoutRef<'td'> & ExtraProps) {
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

function MarkdownUnorderedList({ children, className: listClassName, node }: React.ComponentPropsWithoutRef<'ul'> & ExtraProps) {
  if (node?.properties?.dataVariant === 'steps') return <StepList ordered={false}>{children}</StepList>
  const list = (
    <ul
      className={
        listClassName?.includes('contains-task-list')
          ? 'text-foreground mb-3 max-w-[72ch] list-none space-y-1 pl-1'
          : 'text-foreground mb-3 max-w-[72ch] list-outside list-disc space-y-1 pl-5'
      }
    >
      {children}
    </ul>
  )
  return hasCases(node) ? <CasesScope node={node}>{list}</CasesScope> : list
}

function MarkdownOrderedList({ children, node }: React.ComponentPropsWithoutRef<'ol'> & ExtraProps) {
  if (node?.properties?.dataVariant === 'steps') return <StepList ordered>{children}</StepList>
  const list = <ol className="text-foreground mb-3 max-w-[72ch] list-outside list-decimal space-y-1 pl-5">{children}</ol>
  return hasCases(node) ? <CasesScope node={node}>{list}</CasesScope> : list
}

const MARKDOWN_COMPONENTS = {
  [MARKDOWN_SLOT_TAG]: MarkdownSlot,
  [STREAMING_CARET_TAG]: MarkdownCaret,
  code: MarkdownCode,
  pre: ({ children }: React.ComponentPropsWithoutRef<'pre'>) => <>{children}</>,
  h1: MarkdownH1,
  h2: MarkdownH2,
  h3: MarkdownH3,
  h4: MarkdownH4,
  h5: MarkdownH5,
  h6: MarkdownH6,
  p: MarkdownParagraph,
  ul: MarkdownUnorderedList,
  ol: MarkdownOrderedList,
  li: MarkdownListItem,
  input: MarkdownTaskMark,
  a: MarkdownLink,
  strong: ({ children }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="text-foreground font-medium">{children}</strong>
  ),
  em: ({ children }: React.ComponentPropsWithoutRef<'em'>) => (
    <em className="text-foreground italic">{children}</em>
  ),
  blockquote: AnswerBlockquote,
  hr: () => <hr className="border-base my-4" />,
  table: MarkdownTable,
  caption: MarkdownCaption,
  thead: ({ children }: React.ComponentPropsWithoutRef<'thead'>) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  tbody: ({ children }: React.ComponentPropsWithoutRef<'tbody'>) => <tbody>{children}</tbody>,
  tr: MarkdownRow,
  th: MarkdownHeaderCell,
  td: MarkdownCell,
  [ANSWER_BLOCK_TAG]: AnswerBlock,
  [ANSWER_BLOCK_LABEL_TAG]: AnswerBlockLabel,
  [BLOCK_BODY_TAG]: AnswerBlockBody,
  [ANSWER_MARKER_TAG]: AnswerMarker,
  [ANSWER_ENERGY_TAG]: AnswerEnergy,
  [ANSWER_PROJECT_TAG]: AnswerProject,
  [NOT_FOUND_TAG]: NotFound,
  [PANE_TAG]: Pane,
  [SUBSUMPTION_TAG]: Subsumption,
  [SUBSUMPTION_PART_TAG]: StepPart,
  [STEP_HEAD_TAG]: StepPart,
  [STEP_DUE_TAG]: StepPart,
  [STEP_DETAIL_TAG]: StepPart,
  [FIGURES_TAG]: Figures,
  [FIGURE_TAG]: Figure,
  [FIGURE_VALUE_TAG]: StepPart,
  [FIGURE_LABEL_TAG]: StepPart,
  [FIGURE_LIMIT_TAG]: StepPart,
  [COMPARE_STACK_TAG]: CompareStack,
  [COMPARE_VARIANT_TAG]: CompareVariant,
  [COMPARE_TITLE_TAG]: StepPart,
  [COMPARE_ROW_TAG]: CompareRow,
  [COMPARE_LABEL_TAG]: CompareLabel,
  [COMPARE_VALUE_TAG]: CompareValue,
  img: ({ src, alt }: React.ComponentPropsWithoutRef<'img'> & ExtraProps) =>
    typeof src === 'string' && isSameOriginPath(src) ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt ?? ''} loading="lazy" className="border-base my-3 h-auto max-w-full rounded-surface border" />
    ) : typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-brand underline underline-offset-2 hover:opacity-80">
        {alt || src}
      </a>
    ) : (
      <>{alt ?? ''}</>
    ),
} as Components

const isSameOriginPath = (src: string): boolean => /^\/(?![\/\\])/.test(src)

const REHYPE_PLUGINS_AFTER_FIRST: PluggableList = [...REHYPE_PLUGINS, rehypeBlockSeparator]
const REHYPE_PLUGINS_OPEN_AFTER_FIRST: PluggableList = [...REHYPE_PLUGINS_OPEN, rehypeBlockSeparator]
const REHYPE_PLUGINS_CARET: PluggableList = [...REHYPE_PLUGINS_OPEN, rehypeStreamingCaret]
const REHYPE_PLUGINS_CARET_AFTER_FIRST: PluggableList = [...REHYPE_PLUGINS_OPEN_AFTER_FIRST, rehypeStreamingCaret]

function rehypePluginsFor(first: boolean, open: boolean, caret: boolean): PluggableList {
  if (!open) return first ? REHYPE_PLUGINS : REHYPE_PLUGINS_AFTER_FIRST
  if (caret) return first ? REHYPE_PLUGINS_CARET : REHYPE_PLUGINS_CARET_AFTER_FIRST
  return first ? REHYPE_PLUGINS_OPEN : REHYPE_PLUGINS_OPEN_AFTER_FIRST
}

type FootnoteOptions = NonNullable<Options['remarkRehypeOptions']>

interface MarkdownBlockViewProps {
  source: string
  headingIds: string
  compact: boolean
  open: boolean
  remarkPlugins: PluggableList
  rehypePlugins: PluggableList
  footnoteOptions: FootnoteOptions
}

const MarkdownBlockView = memo(function MarkdownBlockView({
  source,
  headingIds,
  compact,
  open,
  remarkPlugins,
  rehypePlugins,
  footnoteOptions,
}: MarkdownBlockViewProps) {
  const ids = useMemo(
    (): ReadonlyMap<number, string> =>
      headingIds ? new Map(JSON.parse(headingIds) as [number, string][]) : NO_HEADINGS,
    [headingIds]
  )
  const streamingLines = useMemo(() => (open ? source.trimEnd().split('\n') : null), [open, source])
  const renderState = useMemo(
    (): MarkdownRenderState => ({ compact, headingIds: ids, streamingLines }),
    [compact, ids, streamingLines]
  )
  return (
    <MarkdownRenderStateContext.Provider value={renderState}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={footnoteOptions}
        components={MARKDOWN_COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </MarkdownRenderStateContext.Provider>
  )
})

function headingIdsByBlock(content: string, blocks: readonly MarkdownBlock[]): string[] {
  const perBlock: [number, string][][] = blocks.map(() => [])
  let at = 0
  for (const heading of markdownHeadings(content)) {
    while (at + 1 < blocks.length && blocks[at + 1].line < heading.line) at += 1
    perBlock[at].push([heading.line - blocks[at].line, heading.id])
  }
  return perBlock.map((entries) => (entries.length > 0 ? JSON.stringify(entries) : ''))
}

export const MarkdownRenderer: FC<MarkdownRendererProps> = memo(
  ({ content, className = '', compact = false, isStreaming = false, remarkPlugins, caret }) => {
    const t = useTranslations(commonCopy)
    const [streamedHere, setStreamedHere] = useState(isStreaming)
    if (isStreaming && !streamedHere) setStreamedHere(true)
    const footnoteOptions = useMemo(
      (): FootnoteOptions => ({
        footnoteLabel: t('markdown.footnotes'),
        footnoteLabelProperties: { className: ['sr-only'] },
        footnoteBackLabel: (referenceIndex: number) =>
          t('markdown.backToReference', { n: referenceIndex + 1 }),
      }),
      [t]
    )
    const plugins = useMemo(() => {
      const last: PluggableList = [remarkGfm, remarkMath, remarkDirective, remarkAnswerDirectives, ...(remarkPlugins ?? [])]
      return { last, notLast: [remarkBlockContinues, ...last] }
    }, [remarkPlugins])
    const renderedContent = useMemo(
      () => normalizeDirectiveFences(isStreaming ? stabilizeStreamingMarkdown(content) : content),
      [isStreaming, content]
    )
    const blocks = useMemo(
      () => splitMarkdownBlocks(renderedContent) ?? [{ source: renderedContent, line: 0 }],
      [renderedContent]
    )
    const headingIds = useMemo(() => headingIdsByBlock(renderedContent, blocks), [renderedContent, blocks])

    const withCaret = isStreaming && caret !== undefined && caret !== null && caret !== false
    const streamState = useMemo(
      (): MarkdownStreamState => ({ streaming: isStreaming, streamedHere }),
      [isStreaming, streamedHere]
    )

    return (
      <StreamingCaretProvider value={withCaret ? caret : null}>
        <MarkdownStreamStateContext.Provider value={streamState}>
          <div
            className={`markdown-content hyphens-auto [hyphenate-limit-chars:10_4_4] break-words [overflow-wrap:anywhere] [&>*:last-child]:mb-0 ${className}`}
          >
            {blocks.map((block, index) => {
              const last = index === blocks.length - 1
              return (
                <MarkdownBlockView
                  key={index}
                  source={block.source}
                  headingIds={headingIds[index] ?? ''}
                  compact={compact}
                  open={isStreaming && last}
                  remarkPlugins={last ? plugins.last : plugins.notLast}
                  rehypePlugins={rehypePluginsFor(index === 0, isStreaming && last, withCaret)}
                  footnoteOptions={footnoteOptions}
                />
              )
            })}
          </div>
        </MarkdownStreamStateContext.Provider>
      </StreamingCaretProvider>
    )
  }
)

MarkdownRenderer.displayName = 'MarkdownRenderer'
