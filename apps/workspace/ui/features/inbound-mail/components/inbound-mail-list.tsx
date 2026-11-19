'use client'

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronDown, History, Inbox as InboxGlyph, MailOpen, Mails, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { SectionLabel } from '@/components/ui/section-label'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { INBOUND_MAIL_RESTORE_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import {
  INBOUND_MAIL_DECISION_MAX_MAILS,
  type InboundMailListStatus,
  type InboundMailOutcome,
  type InboundMailSummaryView,
  type InboundMailThreadGroupView,
} from '@/lib/inbound-mail/inbound-mail-wire'
import { cn } from '@/lib/utils'
import { isReady } from '../lib/completeness'
import type { ListSection } from '../lib/list-sections'
import { INBOUND_MAIL_READY_ANCHOR } from '@/lib/inbound-mail/paths'
import { InboundMailRow } from './inbound-mail-row'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export type ListState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: InboundMailSummaryView[]; threadGroups: InboundMailThreadGroupView[]; nextCursor: string | null }

export interface InboundMailListProps {
  state: ListState
  sections: ListSection[]
  status: InboundMailListStatus
  onFilterChange: (status: InboundMailListStatus, outcome: InboundMailOutcome | null) => void
  waitingCount: number | null
  waitingMore?: boolean
  openId: string | null
  focusedId: string | null
  checked: ReadonlySet<string>
  onCheckedChange: (mailId: string, checked: boolean) => void
  onFocusRow: (mailId: string) => void
  hrefFor: (mailId: string) => string
  quietOpen: boolean
  onQuietOpenChange: (open: boolean) => void
  onFileGroup: (threadId: string, mailIds: string[]) => void
  fileGroupBusy: string | null
  onFileOne: (mailId: string) => void
  fileOneBusy: string | null
  onFileNow: (mailId: string) => void
  onFileReady: (mailIds: string[]) => void
  onRetry: () => void
  onLoadMore: () => void
  loadingMore: boolean
  everReceived: boolean | null
  addressBlock: ReactNode
  neverCase?: 'address' | 'create' | 'ask'
  showFilter?: boolean
  selectionBar: ReactNode
  notice: ReactNode
  startHint?: ReactNode
  query?: string
  onQueryChange?: (query: string) => void
  matchCount?: number
  now?: number
}

const GROUP_ACTION = 'shrink-0 gap-1.5'
// A thread's press is the quiet text of the dialog's „Ändern“: under the section's button it read as a second, competing one.
const GROUP_LINK = 'text-muted-foreground hover:text-foreground touch-target h-auto shrink-0 p-0 text-xs'

type Block = { key: string; head: Extract<ListSection, { kind: 'readiness' | 'quiet' }> | null; entries: Array<Extract<ListSection, { kind: 'mail' | 'thread' }>> }

function blocksOf(sections: readonly ListSection[]): Block[] {
  const blocks: Block[] = []
  for (const section of sections) {
    if (section.kind === 'readiness' || section.kind === 'quiet') {
      blocks.push({ key: section.kind === 'readiness' ? `readiness-${section.readiness}` : 'quiet', head: section, entries: [] })
      continue
    }
    const last = blocks.at(-1)
    if (last && last.head?.kind !== 'quiet') last.entries.push(section)
    else blocks.push({ key: `rows-${blocks.length}`, head: null, entries: [section] })
  }
  return blocks
}

export function InboundMailList(props: InboundMailListProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { status, onFilterChange, waitingCount, waitingMore = false, showFilter = true, state, query = '', onQueryChange, matchCount } = props
  const searchable = onQueryChange !== undefined && state.kind === 'ready' && (state.items.length > 0 || query !== '')

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbound-mail-list">
      <div className={cn('flex flex-col gap-2 px-4 pb-3 pt-2', !showFilter && 'hidden')} /* 24px under the tabs, as every tab */>
        <ToggleGroup
          type="single"
          segmented
          className="@3xl:bg-selected [&>button]:text-sm"
          size="sm"
          value={status}
          onValueChange={(value) => value && onFilterChange(value as InboundMailListStatus, null)}
          aria-label={t('filters.label')}
        >
          <ToggleGroupItem value="waiting" data-testid="filter-waiting" className="gap-1.5">
            {t('filters.waiting')}
            {/* Held while the count loads, so „Bearbeitet“ does not move when it lands. */}
            {/* One digit's width and no text to read: the one grey on the white thumb, white on the track. */}
            {waitingCount === null && (
              <CountPill tone="muted" aria-hidden className="in-data-[state=off]:bg-background">
                <span className="invisible before:content-['8']" />
              </CountPill>
            )}
            {waitingCount !== null && waitingCount > 0 &&
              (waitingMore ? (
                <CountPill tone="muted" className="in-data-[state=off]:bg-background" data-testid="filter-waiting-count">{`${waitingCount}+`}</CountPill>
              ) : (
                <CountPill count={waitingCount} tone="muted" className="in-data-[state=off]:bg-background" data-testid="filter-waiting-count" />
              ))}
          </ToggleGroupItem>
          <ToggleGroupItem value="handled" data-testid="filter-handled">
            {t('filters.handled')}
          </ToggleGroupItem>
        </ToggleGroup>
        {searchable && (
          <SearchField
            size="sm"
            type="search"
            value={query}
            onChange={onQueryChange}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault()
                onQueryChange('')
              }
            }}
            label={t('search.label')}
            placeholder={t('search.placeholder')}
            clearLabel={t('search.clear')}
            inputClassName="bg-sheet"
          />
        )}
        {/* The result is said once, by a status, never by a live list that would read every row. */}
        <p role="status" className="sr-only" data-testid="inbound-mail-search-status">
          {query === '' || matchCount === undefined ? '' : matchCount === 0 ? t('search.noResults') : t('search.results', { count: matchCount })}
        </p>
        {props.startHint && <div className="pt-1">{props.startHint}</div>}
      </div>
      {props.notice}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ListBody {...props} />
      </div>
      {/* While mails are picked, a white bar floats 16px off the list's foot: elevation 2, the overlay radius (paper on a desk). */}
      {props.selectionBar && (
        <div className="mx-3 mb-[max(1rem,env(safe-area-inset-bottom))] rounded-overlay bg-sheet p-3 shadow-md md:mx-0">{props.selectionBar}</div>
      )}
    </div>
  )
}

function ListBody({
  state,
  sections,
  status,
  openId,
  focusedId,
  checked,
  onCheckedChange,
  onFocusRow,
  hrefFor,
  quietOpen,
  onQuietOpenChange,
  onFileGroup,
  fileGroupBusy,
  onFileOne,
  fileOneBusy,
  onFileNow,
  onFileReady,
  onRetry,
  onLoadMore,
  loadingMore,
  everReceived,
  addressBlock,
  neverCase = 'address',
  onFilterChange,
  query = '',
  onQueryChange,
  now,
}: InboundMailListProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" data-testid="inbound-mail-list-loading">
        <div className="flex min-h-7 items-center px-4 pt-4 pb-1">
          <Skeleton className="h-3 w-16" />
        </div>
        <ul className="flex flex-col px-1">
          {[0, 1, 2, 3, 4].map((row) => (
            <li key={row} className="flex items-start gap-3 px-3 py-3">
              <span className="flex h-8 w-4 shrink-0 items-center" aria-hidden>
                <Skeleton className="size-4 rounded-inline" />
              </span>
              <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5 pt-0.5" /* 38px, the loaded row's two lines: 62px a row, so nothing jumps */>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="p-4">
        <LoadError title={t('loadError')} onRetry={onRetry} />
      </div>
    )
  }
  if (state.items.length === 0) {
    if (status === 'handled') {
      return (
        <div className="p-4">
          <EmptyState variant="bare" icon={History} title={t('empty.handledTitle')} description={t('empty.handledText', { days: INBOUND_MAIL_RESTORE_DAYS })} />
        </div>
      )
    }
    if (everReceived === false) {
      const teaches = neverCase === 'address'
      return (
        <div className="box-content flex max-w-lg flex-col gap-6 px-4 pb-4 pt-2 sm:pb-6" data-testid="inbound-mail-never" /* one 512px width for its words and its panel */>
          {/* One column, one edge: the glyph, the words and the sheet stand on the column's left edge, where the title
              and the tabs stand. Centred in the pane at 464px it was an edge of its own (round 3). */}
          {/* One sentence says what to do, and the address with „Kopieren“ comes right after it: a first visit ends with
              the address in the clipboard. The redirect for an existing project address is the IT's, folded under it. */}
          <EmptyState
            variant="bare"
            className="items-start py-0 text-left phone:px-0 [&>p]:max-w-none"
            icon={InboxGlyph}
            title={t('empty.neverTitle')}
            description={teaches ? t('address.lead') : t(neverCase === 'create' ? 'empty.neverNoAddress' : 'empty.neverNoAddressMember')}
            data-testid="inbound-mail-never-lead"
          />
          {addressBlock}
        </div>
      )
    }
    return (
      <div className="p-4">
        <EmptyState
          variant="bare"
          icon={CheckCircle2}
          title={t('empty.doneTitle')}
          description={t('empty.doneText')}
          data-testid="inbound-mail-done"
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => onFilterChange('handled', null)}>
              <MailOpen className="size-4" aria-hidden />
              {t('empty.showHandled')}
            </Button>
          }
        />
      </div>
    )
  }
  if (sections.length === 0 && query !== '') {
    return (
      <div className="p-4">
        <EmptyState
          variant="bare"
          icon={SearchX}
          title={t('search.noneTitle', { query })}
          description={t('search.noneHint')}
          data-testid="inbound-mail-no-match"
          action={
            onQueryChange && (
              <Button type="button" variant="secondary" size="sm" onClick={() => onQueryChange('')}>
                {t('search.clear')}
              </Button>
            )
          }
        />
      </div>
    )
  }

  const picking = checked.size > 0
  const row = (mail: InboundMailSummaryView, group?: string): JSX.Element => (
    <InboundMailRow
      key={mail.id}
      inGroup={group !== undefined}
      groupThread={group}
      onFileAsSuggested={status === 'waiting' ? () => onFileOne(mail.id) : undefined}
      filingAsSuggested={fileOneBusy === mail.id}
      onFileNow={status === 'waiting' ? () => onFileNow(mail.id) : undefined}
      mail={mail}
      href={hrefFor(mail.id)}
      open={mail.id === openId}
      focused={mail.id === focusedId}
      checked={checked.has(mail.id)}
      selecting={checked.size > 0}
      onCheckedChange={(value) => onCheckedChange(mail.id, value)}
      onFocusRow={() => onFocusRow(mail.id)}
      now={now}
    />
  )

  const entries = (list: Block['entries']): JSX.Element[] => {
    const out: JSX.Element[] = []
    let run: InboundMailSummaryView[] = []
    const flush = () => {
      if (run.length === 0) return
      out.push(
        <ul key={`run-${run[0].id}`} className="flex flex-col px-1" /* rows touch: two picked rows are one region, not two boxes */>
          {run.map((mail) => row(mail))}
        </ul>
      )
      run = []
    }
    for (const entry of list) {
      if (entry.kind === 'mail') {
        run.push(entry.mail)
        continue
      }
      flush()
      out.push(threadGroup(entry))
    }
    flush()
    return out
  }

  const threadGroup = (section: Extract<ListSection, { kind: 'thread' }>): JSX.Element => {
    const groupKey = `${section.threadId}:${section.mails[0]?.id ?? ''}`
    const batch = section.mails.slice(0, INBOUND_MAIL_DECISION_MAX_MAILS)
    return (
      <section key={groupKey} aria-label={t('group.thread', { name: section.name, count: section.mails.length })} data-testid={`thread-group-${section.threadId}`}>
        {/* One line: what the group is on the left, the one press on the right, in the section heading's quiet voice. */}
        {/* A 40px line (44px under touch) with the 32px press centred in it, and 8px under it before the first row:
            round 2 and 3 drew the line as tall as the press, and the press sat on the open row's sheet edge. */}
        <div className="box-content flex h-10 items-center justify-between gap-2 px-4 pb-2 pointer-coarse:h-11" /* fixed: one height with its press or without, so ticking a box moves nothing */>
          {/* The thread's glyph and name; its title and the section's label say „E-Mail-Verlauf“ and how many in full. */}
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium" title={t('group.thread', { name: section.name, count: section.mails.length })}>
            {/* A stack of mails: the circling arrows read as „sync“. */}
            <Mails className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{t('group.threadLine', { name: section.name })}</span>
          </p>
          {picking ? null : section.mails.every(isReady) ? (
            <BusyButton
              type="button"
              variant="inline"
              className={GROUP_LINK}
              busy={fileGroupBusy === groupKey}
              busyLabel={t('bulk.fileSuggestedBusy')}
              onClick={() => onFileGroup(groupKey, batch.map((mail) => mail.id))}
              data-testid="thread-group-file"
            >
              {t(batch.length < section.mails.length ? 'group.threadActionFirst' : 'group.threadAction', { count: batch.length })}
            </BusyButton>
          ) : (
            <Button asChild variant="inline" className={GROUP_LINK}>
              <Link href={hrefFor(section.mails[0].id)} data-testid="thread-group-open">
                {t('group.reviewInOrder')}
              </Link>
            </Button>
          )}
        </div>
        {/* Its rows hang from the group's glyph, so the press's count is the rows inside the line and no others. */}
        <ul className="border-hairline ml-[22px] flex flex-col border-l pl-1" data-testid="thread-group-rows">{section.mails.map((mail) => row(mail, section.name))}</ul>
      </section>
    )
  }

  return (
    /* One rhythm: 32px between sections, 12px between a heading, a thread and a run of rows inside one. The gaps were
       each block's own padding (36px over a heading, 24px after a thread, 4px after a run) and summed unevenly. */
    <div className="flex flex-col gap-8 pt-1 pb-3" data-testid="inbound-mail-sections">
      {blocksOf(sections).map((block) => {
        const head = block.head
        if (head?.kind === 'quiet') {
          return (
            <Collapsible key={block.key} open={quietOpen} onOpenChange={onQuietOpenChange} asChild>
              <section data-testid="quiet-group" className="flex flex-col gap-1">
                <CollapsibleTrigger
                  className="text-muted-foreground hover:bg-hover flex w-full items-center gap-2 rounded-control px-4 py-2 text-left text-xs font-medium outline-none transition-colors duration-snap ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 motion-reduce:transition-none pointer-coarse:min-h-11"
                  data-testid="quiet-group-toggle"
                >
                  <ChevronDown className={cn('size-3.5 transition-transform duration-quick ease-out motion-reduce:transition-none', !quietOpen && '-rotate-90')} aria-hidden />
                  {t('group.quiet')}
                  {/* The count is the sections' muted pill: one way to write a count in the list. */}
                  <CountPill count={head.mails.length} tone="muted" />
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-1">
                  <p className="text-muted-foreground px-4 text-xs">{t('group.quietHint')}</p>
                  <ul className="flex flex-col px-1">{head.mails.map((mail) => row(mail))}</ul>
                </CollapsibleContent>
              </section>
            </Collapsible>
          )
        }
        if (!head) return <div key={block.key} className="flex flex-col gap-3">{entries(block.entries)}</div>
        const ready = head.readiness === 'ready'
        const batch = head.mails.slice(0, INBOUND_MAIL_DECISION_MAX_MAILS)
        const soleThread = block.entries.length === 1 && block.entries[0].kind === 'thread'
        return (
          <div key={block.key} className="flex flex-col gap-3">
            <div
              id={ready ? INBOUND_MAIL_READY_ANCHOR : undefined}
              data-readiness={head.readiness}
              className="flex scroll-mt-2 flex-col gap-1 px-4"
              data-testid={`readiness-${head.readiness}`}
            >
              <div className="flex min-h-8 items-center justify-between gap-2" /* one height with its press or without */>
                {/* What „Ablagebereit“ means is the label's hover, not a second line over every list. */}
                {/* The count is the tabs' muted pill, not brackets: one way to write a count on the page. */}
                {/* A section outranks a thread: 13px in ink here, the thread's line 12px muted. */}
                <SectionLabel as="h3" title={ready ? t('readiness.readyHint') : undefined} className="text-foreground flex items-center gap-1.5 !text-[length:var(--text-section)] !leading-6 !font-semibold">
                  {t(`readiness.${head.readiness}`)}
                  <CountPill count={head.mails.length} tone="muted" />
                </SectionLabel>
                {ready && batch.length > 1 && !picking && !soleThread && (
                  <Button type="button" size="sm" variant="secondary" className={GROUP_ACTION} onClick={() => onFileReady(batch.map((mail) => mail.id))} data-testid="readiness-file-all">
                    {/* No glyph, as the thread's press has none: row-end actions are text presses. One request decides at
                        most twenty mails: past that, the press says it files the first ones. */}
                    {t(batch.length < head.mails.length ? 'readiness.fileFirst' : 'readiness.fileAll', { count: batch.length })}
                  </Button>
                )}
              </div>
              {head.readiness === 'others' && <p className="text-muted-foreground text-xs">{t('readiness.othersHint')}</p>}
            </div>
            {entries(block.entries)}
          </div>
        )
      })}
      {state.nextCursor && (
        <div className="flex justify-center px-3">
          <BusyButton type="button" variant="secondary" size="sm" busy={loadingMore} busyLabel={t('loadMore')} onClick={onLoadMore}>
            {t('loadMore')}
          </BusyButton>
        </div>
      )}
    </div>
  )
}
