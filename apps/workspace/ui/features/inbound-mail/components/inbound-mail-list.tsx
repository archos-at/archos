'use client'

/**
 * The E-Mail-Eingang's list pane: the two lists („Wartet auf Ablage ·
 * Bearbeitet“), the waiting rows under „Bereit“ and „Braucht Sie“ in their
 * sections (thread groups, the quiet group of unconfirmed and automatic mail),
 * and every state the list can be in, each with its own words: loading,
 * failed, never used (which teaches the address in place), all done, nothing
 * handled yet.
 *
 * „Bearbeitet“ is one list: each row already says what became of its mail, so
 * the facets it had (Abgelegt, Verworfen, Abgelaufen) were cut (the owner's
 * review, 2026-10-27). The route still takes `?outcome=`, and so does the
 * `inbound-mail-list` operation: only the buttons went.
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronDown, History, Inbox as InboxGlyph, MailOpen, Mails } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
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
  /** The waiting count beside the first filter; null while unknown. */
  waitingCount: number | null
  openId: string | null
  focusedId: string | null
  checked: ReadonlySet<string>
  onCheckedChange: (mailId: string, checked: boolean) => void
  onFocusRow: (mailId: string) => void
  hrefFor: (mailId: string) => string
  quietOpen: boolean
  onQuietOpenChange: (open: boolean) => void
  /** File a whole thread group as suggested. */
  onFileGroup: (threadId: string, mailIds: string[]) => void
  fileGroupBusy: string | null
  /** File one ready mail as suggested, from its row. */
  onFileOne: (mailId: string) => void
  /** The ready row whose press is in flight. */
  fileOneBusy: string | null
  /** File every ready mail of the page (at most one request's worth) as suggested, after the confirmation. */
  onFileReady: (mailIds: string[]) => void
  onRetry: () => void
  onLoadMore: () => void
  loadingMore: boolean
  /** Whether the project ever received mail; null while unknown. Decides „never used“ against „all done“. */
  everReceived: boolean | null
  /** The address, for the never-used state. */
  addressBlock: ReactNode
  /**
   * What the never-used state says about the address: it is below (`address`),
   * there is none yet and the reader can make one (`create`), or there is none
   * and someone who manages the project has to (`ask`).
   */
  neverCase?: 'address' | 'create' | 'ask'
  /** The Wartet/Bearbeitet switch; off while nothing ever arrived, when there is nothing to switch between. */
  showFilter?: boolean
  /** The selection bar, pinned under the list while something is selected. */
  selectionBar: ReactNode
  /** The closed-project notice, above the rows. */
  notice: ReactNode
}

/** A thread group's press: quiet text at the line's end, a finger's 44px under touch. */
const GROUP_ACTION =
  'text-muted-foreground hover:text-foreground -mr-2 h-7 shrink-0 gap-1.5 px-2 text-xs pointer-coarse:min-h-11'

export function InboundMailList(props: InboundMailListProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { status, onFilterChange, waitingCount, showFilter = true } = props

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbound-mail-list">
      <div className={cn('flex flex-col gap-2 px-4 py-3', !showFilter && 'hidden')}>
        <ToggleGroup
          type="single"
          segmented
          bare
          // The first segment's label on the list's edge on a desk: its fill bleeds by its inset, as the tabs' does.
          className="md:-ml-3"
          size="sm"
          value={status}
          onValueChange={(value) => value && onFilterChange(value as InboundMailListStatus, null)}
          aria-label={t('filters.label')}
        >
          <ToggleGroupItem value="waiting" data-testid="filter-waiting" className="gap-1.5">
            {t('filters.waiting')}
            {waitingCount !== null && waitingCount > 0 && <CountPill count={waitingCount} tone="muted" className="in-data-[state=on]:bg-background" />}
          </ToggleGroupItem>
          <ToggleGroupItem value="handled" data-testid="filter-handled">
            {t('filters.handled')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {props.notice}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ListBody {...props} />
      </div>
      {/* A band of the one grey under the list while mails are picked, as Dateien's: a mode, set apart by its tone. */}
      {props.selectionBar && (
        <div data-surface="sunken" className="bg-muted px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:-mx-4 md:px-8" /* the column's full width, its content on the list's edge */>{props.selectionBar}</div>
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
  onFileReady,
  onRetry,
  onLoadMore,
  loadingMore,
  everReceived,
  addressBlock,
  neverCase = 'address',
  onFilterChange,
}: InboundMailListProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  if (state.kind === 'loading') {
    return (
      // The loaded list's geometry: a section label where „Bereit“ stands, then rows of a subject and a sender at the
      // rows' pitch, in the list's 6px, the row's inset and the checkbox's column. No hairlines: the rows have none.
      <div aria-busy="true" data-testid="inbound-mail-list-loading">
        <div className="flex min-h-7 items-center px-4 pt-4 pb-1">
          <Skeleton className="h-3 w-16" />
        </div>
        <ul className="flex flex-col gap-0.5 px-1">
          {[0, 1, 2, 3, 4].map((row) => (
            <li key={row} className="flex items-start gap-3 px-3 py-3">
              <span className="flex h-8 w-4 shrink-0 items-center" aria-hidden>
                <Skeleton className="size-4 rounded-inline" />
              </span>
              <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2 pt-0.5">
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
          <EmptyState icon={History} title={t('empty.handledTitle')} description={t('empty.handledText', { days: INBOUND_MAIL_RESTORE_DAYS })} />
        </div>
      )
    }
    if (everReceived === false) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6" data-testid="inbound-mail-never">
          {/* One sheet holds the address below: the words above it stand on the page, not in a second box. */}
          <EmptyState
            variant="bare"
            icon={InboxGlyph}
            title={t('empty.neverTitle')}
            description={t(neverCase === 'create' ? 'empty.neverNoAddress' : neverCase === 'ask' ? 'empty.neverNoAddressMember' : 'empty.neverText')}
          />
          {addressBlock}
        </div>
      )
    }
    return (
      <div className="p-4">
      <EmptyState
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

  // While mails are picked the bar under the list is the one way to file them: the heading's and the thread's presses step back.
  const picking = checked.size > 0
  const row = (mail: InboundMailSummaryView, inGroup = false): JSX.Element => (
    <InboundMailRow
      key={mail.id}
      inGroup={inGroup}
      onFileAsSuggested={status === 'waiting' ? () => onFileOne(mail.id) : undefined}
      filingAsSuggested={fileOneBusy === mail.id}
      mail={mail}
      href={hrefFor(mail.id)}
      open={mail.id === openId}
      focused={mail.id === focusedId}
      checked={checked.has(mail.id)}
      selecting={checked.size > 0}
      onCheckedChange={(value) => onCheckedChange(mail.id, value)}
      onFocusRow={() => onFocusRow(mail.id)}
    />
  )

  return (
    <div className="flex flex-col">
      {sections.map((section) => {
        // Rows sit apart by a gap and answer with a fill, not a rule under each.
        if (section.kind === 'mail') return <ul key={section.mail.id} className="flex flex-col gap-0.5 px-1 py-0.5">{row(section.mail)}</ul>
        if (section.kind === 'readiness') {
          const ready = section.readiness === 'ready'
          const batch = section.mails.slice(0, INBOUND_MAIL_DECISION_MAX_MAILS)
          return (
            <div
              key={`readiness-${section.readiness}`}
              // The Postfach's „E-Mails warten“ row links here (`lib/inbox/targets.ts`).
              id={ready ? INBOUND_MAIL_READY_ANCHOR : undefined}
              data-readiness={section.readiness}
              // The list's first heading sits 8px under the filter; later ones open a section with 16px.
              className="flex scroll-mt-2 flex-col gap-1 px-4 pt-4 pb-1 first:pt-1"
              data-testid={`readiness-${section.readiness}`}
            >
              <div className="flex min-h-7 items-center justify-between gap-2">
                {/* What „Bereit“ means is the label's hover, not a second line over every list. */}
                {/* The count is the tabs' muted pill, not brackets: one way to write a count on the page. */}
                {/* A section outranks a thread: 13px in ink here, the thread's line 12px muted. */}
                <SectionLabel as="h3" title={ready ? t('readiness.readyHint') : undefined} className="text-foreground flex items-center gap-1.5 text-[13px]">
                  {t(`readiness.${section.readiness}`)}
                  <CountPill count={section.mails.length} tone="muted" />
                </SectionLabel>
                {ready && batch.length > 1 && !picking && (
                  <Button type="button" size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground -mr-2 gap-1.5 h-7 px-2 text-xs pointer-coarse:min-h-11" onClick={() => onFileReady(batch.map((mail) => mail.id))} data-testid="readiness-file-all">
                    {/* No glyph, as the thread's press has none: row-end actions are text presses. One request decides at
                        most twenty mails: past that, the press says it files the first ones. */}
                    {t(batch.length < section.mails.length ? 'readiness.fileFirst' : 'readiness.fileAll', { count: batch.length })}
                  </Button>
                )}
              </div>
              {section.readiness === 'others' && <p className="text-muted-foreground text-xs">{t('readiness.othersHint')}</p>}
            </div>
          )
        }
        if (section.kind === 'thread') {
          // A thread's ready and waiting halves are two groups (`listSections`): the first mail tells them apart.
          const groupKey = `${section.threadId}:${section.mails[0]?.id ?? ''}`
          // One request decides at most twenty mails; in filing order, the first twenty keep their Fassungen.
          const batch = section.mails.slice(0, INBOUND_MAIL_DECISION_MAX_MAILS)
          return (
            <section key={groupKey} aria-label={t('group.thread', { name: section.name, count: section.mails.length })} data-testid={`thread-group-${section.threadId}`}>
              {/* One line: what the group is on the left, the one press on the right, in the „Bereit“ heading's quiet voice. */}
              {/* Centred: under touch the press is 44px tall. Right under its section's heading it sits 4px below it. */}
              <div className="flex min-h-10 items-center justify-between gap-2 px-4 pt-3 [[data-readiness]+section>&]:pt-1" /* one height with its press or without */>
                {/* The thread's glyph and name; its title and the section's label say „E-Mail-Verlauf“ and how many in full. */}
                <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium" title={t('group.thread', { name: section.name, count: section.mails.length })}>
                  {/* A stack of mails: the circling arrows read as „sync“. */}
                  <Mails className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">{t('group.threadLine', { name: section.name })}</span>
                </p>
                {picking ? null : section.mails.every(isReady) ? (
                  <BusyButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    // No glyph: the file glyph is the „Bereit“ heading's press for all of them; this one files the thread.
                    className={GROUP_ACTION}
                    busy={fileGroupBusy === groupKey}
                    busyLabel={t('bulk.fileSuggestedBusy')}
                    onClick={() => onFileGroup(groupKey, batch.map((mail) => mail.id))}
                    data-testid="thread-group-file"
                  >
                    {t(batch.length < section.mails.length ? 'group.threadActionFirst' : 'group.threadAction', {
                      count: batch.length,
                      first: section.firstVersion,
                      last: section.firstVersion + batch.length - 1,
                    })}
                  </BusyButton>
                ) : (
                  // Every mail of this half needs the person: the way in is its first mail, and no Fassung range is promised.
                  <Button asChild size="sm" variant="ghost" className={GROUP_ACTION}>
                    <Link href={hrefFor(section.mails[0].id)} data-testid="thread-group-open">
                      {t('group.reviewInOrder')}
                    </Link>
                  </Button>
                )}
              </div>
              {/* 24px after its last member, the gap between sections: a row below it visibly stands outside the thread. */}
              <ul className="flex flex-col gap-0.5 px-1 pt-0.5 pb-6">{section.mails.map((mail) => row(mail, true))}</ul>
            </section>
          )
        }
        return (
          // More of this list, in place: the design language's `Collapsible`.
          <Collapsible key="quiet" open={quietOpen} onOpenChange={onQuietOpenChange} asChild>
            <section data-testid="quiet-group">
              <CollapsibleTrigger
                className="text-muted-foreground hover:bg-accent flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium outline-none transition-colors duration-snap ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 motion-reduce:transition-none pointer-coarse:min-h-11"
                data-testid="quiet-group-toggle"
              >
                <ChevronDown className={cn('size-3.5 transition-transform duration-quick ease-out motion-reduce:transition-none', !quietOpen && '-rotate-90')} aria-hidden />
                {t('group.quiet', { count: section.mails.length })}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="text-muted-foreground px-4 pb-2 text-xs">{t('group.quietHint')}</p>
                <ul className="flex flex-col gap-0.5 px-1 py-0.5">{section.mails.map((mail) => row(mail))}</ul>
              </CollapsibleContent>
            </section>
          </Collapsible>
        )
      })}
      {state.nextCursor && (
        <div className="flex justify-center p-3">
          <BusyButton type="button" variant="secondary" size="sm" busy={loadingMore} busyLabel={t('loadMore')} onClick={onLoadMore}>
            {t('loadMore')}
          </BusyButton>
        </div>
      )}
    </div>
  )
}
