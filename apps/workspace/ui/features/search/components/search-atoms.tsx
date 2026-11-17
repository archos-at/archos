'use client'

import type { FormEvent, JSX, ReactNode } from 'react'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Archive, ChevronRight, Folder, FolderKanban, History, Users, X } from 'lucide-react'

import { ShortcutKeys } from '@/components/shell/shortcut-keys'
import { MOD, type KeySegment } from '@/components/shell/shortcuts'
import { Button } from '@/components/ui/button'
import { Chip, ChipLabel } from '@/components/ui/chip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CommandHints, type CommandHintLabels } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { Item, ItemContent, ItemMedia } from '@/components/ui/item'
import { Label } from '@/components/ui/label'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { SortableHead } from '@/components/ui/sortable-head'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import type { TextSegment } from '@/lib/text/term-segments'
import { sourceBase, sourceTint } from '@/lib/ui/source-tint'
import { cn } from '@/lib/utils'
import { CompactMatchHint, CompactPassage } from './palette-atoms'
import { MatchedSegments } from './match-mark'
import { ResultRowFrameContext, useCompactRow } from './row-frame'
import { fitColumns, minimumRem, type ColumnFit } from '../lib/register-fit'

export function SearchFrame({ toolbar, rail, children }: { toolbar: ReactNode; rail: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="search-frame">
      <div className="flex min-w-0 flex-col gap-3">{toolbar}</div>
      <div className="flex min-w-0 flex-col gap-6 md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:items-start md:gap-0">
        {rail ? (
          <aside
            className="hidden min-w-0 flex-col gap-1 md:sticky md:top-4 md:flex md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto md:border-r md:pr-3"
            data-testid="search-rail"
          >
            {rail}
          </aside>
        ) : null}
        <div className="flex min-w-0 flex-col gap-3 md:pl-6">{children}</div>
      </div>
    </div>
  )
}

export function FilterSheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  clearLabel,
  onClear,
  canClear,
  showLabel,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  closeLabel: string
  clearLabel: string
  onClear: () => void
  canClear: boolean
  showLabel: string
  children: ReactNode
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={closeLabel} data-testid="search-filter-sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex min-w-0 flex-col gap-1" data-testid="search-rail">
          {children}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClear} disabled={!canClear} data-testid="search-sheet-clear">
            {clearLabel}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)} data-testid="search-sheet-show">
            {showLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SearchToolbar({ field, controls }: { field: ReactNode; controls: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="search-toolbar">
      <div className="min-w-0 flex-[1_1_20rem]">{field}</div>
      <div className="flex flex-wrap items-center gap-2">{controls}</div>
    </div>
  )
}

export function ToolbarLabel({ children }: { children: ReactNode }): JSX.Element {
  return <span className="max-sm:sr-only">{children}</span>
}

export function FieldShortcut(): JSX.Element {
  return <ShortcutKeys segments={FOCUS_FIELD_KEYS} />
}

const FOCUS_FIELD_KEYS: readonly KeySegment[] = [{ kind: 'chord', caps: [MOD, 'K'] }]

export function KeysHint({ children }: { children: ReactNode }): JSX.Element {
  return <span className="max-sm:hidden pointer-coarse:hidden">{children}</span>
}

export function ChoiceStrip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <HorizontalScroll cue aria-label={label} className="-mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </HorizontalScroll>
  )
}

export function RailSection({
  title,
  children,
  testId,
  defaultOpen = true,
  fixed = false,
}: {
  title: string
  children: ReactNode
  testId?: string
  defaultOpen?: boolean
  fixed?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  if (fixed) {
    return (
      <section className="flex min-w-0 flex-col border-b border-border/60 py-2 last:border-b-0" data-testid={testId}>
        <div className="flex h-7 items-center px-1">
          <SectionLabel as="h3">{title}</SectionLabel>
        </div>
        <div className="flex min-w-0 flex-col pt-0.5">{children}</div>
      </section>
    )
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className="flex min-w-0 flex-col border-b border-border/60 py-2 last:border-b-0" data-testid={testId}>
        <CollapsibleTrigger
          className={cn('group flex h-7 w-full items-center gap-1 rounded-sm px-1 text-left', FOCUS_RING_INSET)}
          data-testid={testId ? `${testId}-toggle` : undefined}
        >
          <ChevronRight
            className="size-3 shrink-0 text-muted-foreground transition-transform duration-quick ease-out group-data-[state=open]:rotate-90 motion-reduce:transition-none"
            aria-hidden
          />
          <SectionLabel as="h3">{title}</SectionLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col pt-0.5">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

export function FacetOption({
  label,
  count,
  active,
  onToggle,
  testId,
}: {
  label: string
  count: number
  active: boolean
  onToggle: () => void
  testId?: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        'flex min-h-7 w-full min-w-0 items-start gap-2 rounded-sm px-1 py-1 text-left text-sm leading-5 transition-colors duration-snap ease-out motion-reduce:transition-none pointer-coarse:min-h-11 pointer-coarse:items-center',
        FOCUS_RING_INSET,
        active ? 'bg-secondary font-medium text-foreground' : 'text-foreground/80 hover:bg-hover hover:text-foreground'
      )}
    >
      <span
        className={cn(
          'mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-snap pointer-coarse:mt-0',
          active ? 'border-foreground bg-foreground text-background' : 'border-strong bg-background'
        )}
        aria-hidden
      >
        {active ? (
          <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.5 5 9l4.5-5.5" />
          </svg>
        ) : null}
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 break-words" title={label.length > 48 ? label : undefined}>
        {label}
      </span>
      <span className="shrink-0 text-xs leading-5 tabular-nums text-muted-foreground">{count}</span>
    </button>
  )
}

export function FacetFind({ children }: { children: ReactNode }): JSX.Element {
  return <div className="px-1 pb-1.5 pointer-fine:[&_input]:h-8">{children}</div>
}

export function RailAction({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">{children}</div>
}

export function RailBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-col gap-3 px-1 pb-2 pt-1 pointer-fine:[&_input]:h-8">{children}</div>
}

export function FieldStack({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-col gap-2">{children}</div>
}

export function KeyFieldRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.5rem] items-start gap-2">{children}</div>
}

export function FieldPair({ children }: { children: ReactNode }): JSX.Element {
  return <div className="grid min-w-0 grid-cols-2 gap-2">{children}</div>
}

export function ActiveFilters({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="search-active-filters">
      {children}
    </div>
  )
}

export function RemovableChip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }): JSX.Element {
  return (
    <Chip asChild variant="secondary" interactive size="md">
      <button type="button" onClick={onRemove} aria-label={removeLabel} title={label}>
        <ChipLabel>{label}</ChipLabel>
        <X aria-hidden />
      </button>
    </Chip>
  )
}

export function ResultsStatus({ children, busy }: { children: ReactNode; busy: boolean }): JSX.Element {
  return (
    <p className="flex min-h-5 items-center gap-2 text-xs tabular-nums text-muted-foreground" role="status" aria-live="polite" data-testid="search-status">
      {busy ? <Spinner size="xs" aria-hidden /> : null}
      {/* One run of text: the status and the key hint wrap as a sentence, not as two columns. */}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

export function SearchNote({ children, icon: Icon, testId }: { children: ReactNode; icon: LucideIcon; testId?: string }): JSX.Element {
  return (
    <p className="flex items-start gap-1.5 text-pretty text-xs text-muted-foreground" data-testid={testId}>
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

export function EmptyActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
}

export function KindCount({ children }: { children: ReactNode }): JSX.Element {
  return <span className="ml-1 tabular-nums text-muted-foreground">{children}</span>
}

export { ResultRowFrameProvider, useCompactRow, type ResultRowFrameProps } from './row-frame'

export function ResultSection({
  title,
  count,
  children,
  footer,
  testId,
  listId,
}: {
  title: string
  count: string
  children: ReactNode
  footer?: ReactNode
  testId?: string
  listId?: string
}): JSX.Element {
  return (
    <section className="flex min-w-0 flex-col" data-testid={testId}>
      <header className="flex items-baseline gap-2 pb-1.5">
        <SectionLabel as="h2">{title}</SectionLabel>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </header>
      <ul id={listId} role="listbox" aria-label={title} className="flex min-w-0 flex-col divide-y divide-border/70 border-y border-border/70">
        {children}
      </ul>
      {footer}
    </section>
  )
}


const RESULT_ROW_LAYOUT = 'items-start gap-x-3 px-2 py-2.5'

const ACTIVE_ROW = 'aria-selected:bg-accent/60 aria-selected:shadow-[inset_2px_0_0_0_var(--foreground)]'


export function ResultRow({
  href,
  icon: Icon,
  title,
  meta,
  aside,
  children,
  active = false,
  testId,
  id,
  actions,
}: {
  href: string
  icon: LucideIcon
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  children?: ReactNode
  active?: boolean
  testId?: string
  id?: string
  actions?: ReactNode
}): JSX.Element {
  const Frame = useContext(ResultRowFrameContext)
  const compact = Frame !== null
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const content = (
    <>
      <ItemMedia className="size-5 pt-0.5 text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </ItemMedia>
      <ItemContent className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-start gap-2">
          <span className={cn('min-w-0 flex-1 text-sm font-medium text-foreground', compact ? 'truncate' : 'max-sm:line-clamp-2 sm:truncate')}>{title}</span>
          {aside ? <span className="flex shrink-0 items-center gap-1.5">{aside}</span> : null}
        </span>
        {meta ? (
          <span
            className={cn(
              'block min-w-0 text-xs leading-5 text-muted-foreground',
              compact && 'h-5 overflow-hidden'
            )}
          >
            {meta}
          </span>
        ) : null}
        {children ? compact ? <span className="flex min-w-0 flex-col">{children}</span> : children : null}
      </ItemContent>
    </>
  )
  if (Frame) {
    return (
      <Frame href={href} testId={testId} className={RESULT_ROW_LAYOUT}>
        {content}
      </Frame>
    )
  }
  return (
    <li role="none" className="relative list-none">
      <Item asChild className={cn(RESULT_ROW_LAYOUT, ACTIVE_ROW, actions && ROW_ACTIONS_ROOM)}>
        <Link ref={ref} id={id} href={href} role="option" aria-selected={active} data-testid={testId}>
          {content}
        </Link>
      </Item>
      {actions ? <RowActions>{actions}</RowActions> : null}
    </li>
  )
}

export function MetaPart({ children, code = false }: { children: ReactNode; code?: boolean }): JSX.Element {
  return <span className={cn('whitespace-nowrap', code && 'font-mono text-xs text-foreground/80')}>{children}</span>
}

export function MetaLine({
  parts,
  lead = [],
}: {
  parts: ReadonlyArray<ReactNode | null | undefined | false>
  lead?: ReadonlyArray<ReactNode | null | undefined | false>
}): JSX.Element {
  const present = (list: ReadonlyArray<ReactNode | null | undefined | false>): ReactNode[] => list.filter((part): part is ReactNode => Boolean(part))
  const items = [...present(lead).map((node, index) => ({ node, dot: index === 0 })), ...present(parts).map((node) => ({ node, dot: true }))]
  return (
    <span className="block min-w-0 max-w-full overflow-hidden">
      <span className="-ml-3 flex min-w-0 flex-wrap items-center gap-y-0.5">
        {items.map((item, index) => (
          <span key={index} data-meta-part className="relative inline-flex min-w-0 max-w-full items-center pl-3">
            {item.dot ? (
              <span className="absolute left-0 w-3 text-center text-muted-foreground" aria-hidden>
                ·
              </span>
            ) : null}
            {item.node}
          </span>
        ))}
      </span>
    </span>
  )
}

export function ShelfMark({
  shelf,
  label,
  wrap = false,
  quiet = false,
}: {
  shelf: 'project' | 'office_shelf'
  label: string
  wrap?: boolean
  quiet?: boolean
}): JSX.Element {
  const Icon = shelf === 'office_shelf' ? Archive : FolderKanban
  if (quiet) {
    return (
      <span className="inline-flex min-w-0 max-w-48 items-center gap-1 md:max-w-64" title={label}>
        <Icon className="size-3 shrink-0" style={{ color: sourceBase(shelf === 'office_shelf' ? 'office' : 'project') }} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex min-h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium',
        wrap ? 'max-w-full py-0.5 leading-tight' : 'max-w-40 md:max-w-56'
      )}
      style={sourceTint(shelf === 'office_shelf' ? 'office' : 'project')}
      title={wrap ? undefined : label}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className={wrap ? 'min-w-0 [overflow-wrap:anywhere]' : 'truncate'}>{label}</span>
    </span>
  )
}

export function WherePart({ children, label }: { children: ReactNode; label: string }): JSX.Element {
  const compact = useCompactRow()
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-foreground/75">
      {compact ? null : <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="sr-only">{label} </span>
        {children}
      </span>
    </span>
  )
}

export function SupersededMark({ className, quiet = false }: { className?: string; quiet?: boolean }): JSX.Element {
  const tDocument = useTranslations(searchCopy, 'document')
  if (quiet) {
    return (
      <span className={cn('inline-flex h-5 items-center gap-1 text-xs text-muted-foreground', className)} title={tDocument('supersededHint')} data-testid="superseded-mark">
        <History className="size-3" aria-hidden />
        {tDocument('superseded')}
      </span>
    )
  }
  return (
    <Chip size="sm" variant="outline" className={cn('gap-1 text-muted-foreground', className)} title={tDocument('supersededHint')} data-testid="superseded-mark">
      <History aria-hidden />
      {tDocument('superseded')}
    </Chip>
  )
}

export function HitBadge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' | 'outline' }): JSX.Element {
  return (
    <Chip size="sm" variant={tone}>
      {children}
    </Chip>
  )
}

export function PassageQuote({ segments, page }: { segments: readonly TextSegment[]; page?: string }): JSX.Element {
  if (useCompactRow()) return <CompactPassage segments={segments} page={page} />
  return (
    <p className="mt-1 flex min-w-0 items-baseline gap-2 border-l-2 border-border pl-2.5 text-sm leading-relaxed text-foreground/80" data-testid="search-passage">
      {page ? (
        <Chip size="sm" variant="outline" className="shrink-0 tabular-nums">
          {page}
        </Chip>
      ) : null}
      <span className="line-clamp-2 min-w-0 text-pretty">
        „<MatchedSegments segments={segments} testId="search-passage-match" />“
      </span>
    </p>
  )
}

export function MatchedText({ segments }: { segments: readonly TextSegment[] }): JSX.Element {
  return <MatchedSegments segments={segments} testId="search-title-match" keepUnits={false} />
}

export function Excerpt({ children }: { children: ReactNode }): JSX.Element {
  const compact = useCompactRow()
  return <p className={cn('text-foreground/75', compact ? 'truncate text-xs leading-5 text-muted-foreground' : 'mt-0.5 line-clamp-2 text-pretty text-sm')}>{children}</p>
}

export function MatchHint({ label, parts, testId = 'search-matched-on' }: { label: string; parts: readonly string[]; testId?: string }): JSX.Element {
  if (useCompactRow()) return <CompactMatchHint label={label} parts={parts} testId={testId} />
  return (
    <span className="mt-0.5 text-xs text-muted-foreground" data-testid={testId}>
      {label} {parts.join(' · ')}
    </span>
  )
}

export function ResultsSkeleton({ rows = 6 }: { rows?: number }): JSX.Element {
  return (
    <div className="flex flex-col divide-y divide-border/70 border-y border-border/70" data-testid="search-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-3 px-2 py-3">
          <Skeleton className="size-4" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ResultsBody({ stale, children }: { stale: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-6 transition-opacity duration-quick motion-reduce:transition-none', stale && 'opacity-60')}
      aria-busy={stale || undefined}
      data-testid="search-results"
    >
      {children}
    </div>
  )
}

export function RegisterBar({ start, end }: { start: ReactNode; end: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2" data-testid="search-register-bar">
      <div className="flex min-w-0 items-center gap-2">{start}</div>
      <div className="flex items-center gap-2">{end}</div>
    </div>
  )
}

export function LabelledSwitch({
  id,
  label,
  checked,
  onCheckedChange,
  testId,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  testId?: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} data-testid={testId} />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal text-foreground">
        {label}
      </Label>
    </div>
  )
}

export function RegisterTable({
  children,
  caption,
  testId,
  columns,
  scrollLabel,
  id,
  actionsRem = 0,
}: {
  children: ReactNode
  caption: string
  testId?: string
  id?: string
  columns: readonly ColumnFit[]
  scrollLabel: string
  actionsRem?: number
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [boxRem, setBoxRem] = useState(0)
  const minRem = minimumRem(columns)
  const wide = boxRem > 0 && minRem > boxRem + 0.0625
  const columnWidths = fitColumns(columns, boxRem - actionsRem)

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const update = (): void => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setBoxRem(element.clientWidth / rem)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const table = (
    <table className="w-full table-fixed caption-bottom border-separate border-spacing-0 text-sm" style={{ minWidth: `${minRem}rem` }}>
      {/* The table's name for a screen reader; to the eye the header row says it. */}
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        {columnWidths.map((width, index) => (
          <col key={index} style={width === null ? undefined : { width: `${width}rem` }} />
        ))}
        {actionsRem > 0 ? <col style={{ width: `${actionsRem}rem` }} /> : null}
      </colgroup>
      {children}
    </table>
  )
  return (
    <div ref={box} id={id} className="min-w-0" data-testid={testId} data-wide={wide || undefined}>
      {wide ? (
        <HorizontalScroll cue aria-label={scrollLabel}>
          {table}
        </HorizontalScroll>
      ) : (
        table
      )}
    </div>
  )
}

export function RegisterHead({ children }: { children: ReactNode }): JSX.Element {
  return (
    <TableHeader className="sticky top-0 z-10 bg-background [&_th]:border-y [&_th]:border-border/70 [&_tr]:border-b-0">
      <TableRow className="hover:bg-transparent">{children}</TableRow>
    </TableHeader>
  )
}

export function RegisterHeadCell({
  label,
  numeric = false,
  sort,
}: {
  label: string
  numeric?: boolean
  sort: { ariaLabel: string; direction: 'asc' | 'desc' | null; onSort: () => void }
}): JSX.Element {
  return (
    <SortableHead
      className={cn('h-8 overflow-hidden whitespace-nowrap px-2', numeric && 'text-right')}
      label={label}
      ariaLabel={sort.ariaLabel}
      active={sort.direction !== null}
      direction={sort.direction ?? 'asc'}
      onSort={sort.onSort}
    />
  )
}

export function RegisterBody({ children }: { children: ReactNode }): JSX.Element {
  return <TableBody>{children}</TableBody>
}

export function RegisterRow({ children, active = false, testId, id }: { children: ReactNode; active?: boolean; testId?: string; id?: string }): JSX.Element {
  const ref = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <TableRow
      ref={ref}
      id={id}
      aria-selected={active || undefined}
      className="h-9 border-b-0 [&>td]:border-b [&>td]:border-border/50 aria-selected:bg-selected aria-selected:hover:bg-selected aria-selected:[&>td:first-child]:shadow-[inset_2px_0_0_0_var(--foreground)]"
      data-testid={testId}
    >
      {children}
    </TableRow>
  )
}

export function RegisterCell({
  children,
  kind = 'text',
  title,
  span,
}: {
  children?: ReactNode
  kind?: 'text' | 'strong' | 'code' | 'figure' | 'muted' | 'mark'
  title?: string
  span?: number
}): JSX.Element {
  return (
    <TableCell
      colSpan={span && span > 1 ? span : undefined}
      className={cn(
        'truncate px-2 py-1.5',
        kind === 'strong' && 'font-medium text-foreground',
        kind === 'code' && 'font-mono text-xs',
        kind === 'figure' && 'text-right tabular-nums',
        kind === 'muted' && 'tabular-nums text-muted-foreground',
        kind === 'text' && 'text-foreground/80',
        kind === 'mark' && '[&>*]:max-w-full!'
      )}
      title={title}
    >
      {children}
    </TableCell>
  )
}

export function RegisterTitle({ children, mark }: { children: ReactNode; mark?: ReactNode }): JSX.Element {
  if (!mark) return <>{children}</>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate">{children}</span>
      <span className="flex shrink-0 items-center">{mark}</span>
    </span>
  )
}

export function RegisterLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <Link href={href} className={cn('rounded-sm hover:underline', FOCUS_RING_INSET)}>
      {children}
    </Link>
  )
}

export function RegisterStack({ children, label, testId, id }: { children: ReactNode; label: string; testId?: string; id?: string }): JSX.Element {
  return (
    <ul id={id} role="listbox" className="flex min-w-0 flex-col divide-y divide-border/70 border-y border-border/70" aria-label={label} data-testid={testId}>
      {children}
    </ul>
  )
}

export function RegisterStackRow({
  href,
  code,
  title,
  meta,
  where,
  aside,
  active = false,
  testId,
  id,
  actions,
}: {
  href: string
  code?: ReactNode
  title: ReactNode
  meta?: ReadonlyArray<ReactNode | null | undefined | false>
  where?: ReactNode
  aside?: ReactNode
  active?: boolean
  testId?: string
  id?: string
  actions?: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <li role="none" className="relative list-none">
      <Link
        ref={ref}
        id={id}
        href={href}
        role="option"
        aria-selected={active}
        data-testid={testId}
        className={cn(
          'flex min-w-0 flex-col gap-0.5 px-1 py-2.5 transition-colors duration-snap ease-out hover:bg-hover motion-reduce:transition-none',
          FOCUS_RING_INSET,
          ACTIVE_ROW,
          actions && ROW_ACTIONS_ROOM
        )}
      >
        {code ? <span className="min-w-0 truncate font-mono text-xs text-foreground/80">{code}</span> : null}
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
          {aside ? <span className="flex shrink-0 items-center gap-1.5">{aside}</span> : null}
        </span>
        {meta && meta.some(Boolean) ? (
          <span className="min-w-0 text-xs text-muted-foreground">
            <MetaLine parts={meta} />
          </span>
        ) : null}
        {where ? <span className="flex min-w-0 pt-0.5 text-xs">{where}</span> : null}
      </Link>
      {actions ? <RowActions>{actions}</RowActions> : null}
    </li>
  )
}

export function SavedSearchRow({
  name,
  summary,
  detail,
  onApply,
  controls,
}: {
  name: string
  summary?: string
  detail?: string
  onApply: () => void
  controls?: ReactNode
}): JSX.Element {
  return (
    <li className="flex min-w-0 list-none items-center gap-2 py-1.5">
      <button
        type="button"
        onClick={onApply}
        className={cn('min-w-0 flex-1 rounded-sm text-left', FOCUS_RING_INSET)}
        data-testid="saved-search-apply"
      >
        <span className="line-clamp-2 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{name}</span>
        {summary ? (
          <span className="block truncate text-xs text-muted-foreground" title={summary} data-testid="saved-search-summary">
            {summary}
          </span>
        ) : null}
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </button>
      {controls ? <div className="flex shrink-0 items-center gap-1">{controls}</div> : null}
    </li>
  )
}

export function DialogForm({ children, onSubmit }: { children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void }): JSX.Element {
  return (
    <form className="flex min-w-0 flex-col gap-5" onSubmit={onSubmit} noValidate>
      {children}
    </form>
  )
}

export function ColleagueMark(): JSX.Element {
  return <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

export function SavedSearchList({ children }: { children: ReactNode }): JSX.Element {
  return <ul className="flex max-h-72 min-w-0 flex-col divide-y overflow-y-auto">{children}</ul>
}

export function PanelBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-col gap-3">{children}</div>
}

export function QuietLine({ children, testId }: { children: ReactNode; testId?: string }): JSX.Element {
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  )
}

export function SearchInset({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-w-0 px-4 py-4 md:px-6">{children}</div>
}

const ROW_ACTIONS_ROOM = 'pr-11'

function RowActions({ children }: { children: ReactNode }): JSX.Element {
  return <span className="absolute right-1 top-1.5 flex items-center">{children}</span>
}

export function RegisterActionsHead({ label }: { label: string }): JSX.Element {
  return (
    <th scope="col" className="h-8 px-1">
      <span className="sr-only">{label}</span>
    </th>
  )
}

export function RegisterActionsCell({ children }: { children: ReactNode }): JSX.Element {
  return <TableCell className="px-1 py-0.5 text-right">{children}</TableCell>
}

export const REGISTER_ACTIONS_WIDTH = 2.75

export function ComposerPickerFrame({ children, hints, testId }: { children: ReactNode; hints: CommandHintLabels; testId?: string }): JSX.Element {
  return (
    <div
      className="flex max-h-[360px] w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-1 duration-snap ease-out motion-reduce:animate-none"
      data-testid={testId}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <CommandHints labels={hints} className="pointer-coarse:hidden" />
    </div>
  )
}

export const COMPOSER_COMMAND_CLASS =
  'bg-transparent [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:size-4'
