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

/** A row-end press of a heading or a thread line: the raised press, so „Als Fassung 4–6 ablegen“ reads as a press, not a label. */
const GROUP_ACTION = 'shrink-0 gap-1.5'

export function InboundMailList(props: InboundMailListProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { status, onFilterChange, waitingCount, showFilter = true } = props

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbound-mail-list">
      <div className={cn('flex flex-col gap-2 px-4 pb-3 pt-2', !showFilter && 'hidden')} /* 24px under the tabs, as every tab */>
        <ToggleGroup
          type="single"
          segmented
          // The track on the list's edge. 14px, the tabs' size and Offene Punkte's filter's: one size for a segmented control in Dateien.
          // A track is one step below the plane it lies on: on the split's desk that is the selected grey, or it vanished.
          className="@3xl:bg-selected [&>button]:text-name"
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
            {waitingCount !== null && waitingCount > 0 && <CountPill count={waitingCount} tone="muted" className="in-data-[state=off]:bg-background" />}
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
      return (
        <div className="box-content flex max-w-lg flex-col gap-6 px-4 pb-4 pt-2 sm:pb-6" data-testid="inbound-mail-never" /* one 512px width for its words and its panel */>
          {/* One column, one edge: the glyph, the words and the sheet stand on the column's left edge, where the title
              and the tabs stand. Centred in the pane at 464px it was an edge of its own (round 3). */}
          <EmptyState
            variant="bare"
            className="items-start py-0 text-left phone:px-0 [&>p]:max-w-none"
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
      {sections.map((section, index) => {
        // A run of mails outside any group is one list, so the hairline between two of them is drawn as in a thread:
        // the run is rendered at its first mail and skipped after it.
        if (section.kind === 'mail') {
          if (sections[index - 1]?.kind === 'mail') return null
          const run = sections.slice(index).findIndex((next) => next.kind !== 'mail')
          const mails = sections.slice(index, run < 0 ? undefined : index + run).flatMap((next) => (next.kind === 'mail' ? [next.mail] : []))
          return <ul key={section.mail.id} className="flex flex-col px-1 py-0.5">{mails.map((mail) => row(mail))}</ul>
        }
        if (section.kind === 'readiness') {
          const ready = section.readiness === 'ready'
          const batch = section.mails.slice(0, INBOUND_MAIL_DECISION_MAX_MAILS)
          // A section that is one thread and nothing else: the thread's own press files the same mails, so the
          // section's would be a second press for one act, 40px above it.
          const next = sections[index + 1]
          const soleThread = next?.kind === 'thread' && next.mails.length === section.mails.length && sections[index + 2]?.kind !== 'mail'
          return (
            <div
              key={`readiness-${section.readiness}`}
              // The Postfach's „E-Mails warten“ row links here (`lib/inbox/targets.ts`).
              id={ready ? INBOUND_MAIL_READY_ANCHOR : undefined}
              data-readiness={section.readiness}
              // A section opens about 48px of white under the row above it (the row's 12px inset counted), twice a
              // thread's 24px end, which it absorbs after a thread; the list's first heading sits under the filter.
              className="flex scroll-mt-2 flex-col gap-1 px-4 pt-9 pb-1 first:pt-1 [section+&]:pt-3"
              data-testid={`readiness-${section.readiness}`}
            >
              <div className="flex min-h-8 items-center justify-between gap-2" /* one height with its press or without */>
                {/* What „Bereit“ means is the label's hover, not a second line over every list. */}
                {/* The count is the tabs' muted pill, not brackets: one way to write a count on the page. */}
                {/* A section outranks a thread: 13px in ink here, the thread's line 12px muted. */}
                <SectionLabel as="h3" title={ready ? t('readiness.readyHint') : undefined} className="text-foreground flex items-center gap-1.5 !text-[length:var(--text-section)] !leading-6 !font-medium">
                  {t(`readiness.${section.readiness}`)}
                  <CountPill count={section.mails.length} tone="muted" />
                </SectionLabel>
                {ready && batch.length > 1 && !picking && !soleThread && (
                  <Button type="button" size="sm" variant="secondary" className={GROUP_ACTION} onClick={() => onFileReady(batch.map((mail) => mail.id))} data-testid="readiness-file-all">
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
                    size="sm"
                    variant="secondary"
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
                  <Button asChild size="sm" variant="secondary" className={GROUP_ACTION}>
                    <Link href={hrefFor(section.mails[0].id)} data-testid="thread-group-open">
                      {t('group.reviewInOrder')}
                    </Link>
                  </Button>
                )}
              </div>
              {/* 24px after its last member, the gap between sections: a row below it visibly stands outside the thread. */}
              <ul className="flex flex-col px-1 pb-6" /* rows touch: two picked rows are one region, not two boxes */>{section.mails.map((mail) => row(mail, true))}</ul>
            </section>
          )
        }
        return (
          // More of this list, in place: the design language's `Collapsible`.
          <Collapsible key="quiet" open={quietOpen} onOpenChange={onQuietOpenChange} asChild>
            <section data-testid="quiet-group">
              <CollapsibleTrigger
                className="text-muted-foreground hover:bg-hover flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium outline-none transition-colors duration-snap ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 motion-reduce:transition-none pointer-coarse:min-h-11"
                data-testid="quiet-group-toggle"
              >
                <ChevronDown className={cn('size-3.5 transition-transform duration-quick ease-out motion-reduce:transition-none', !quietOpen && '-rotate-90')} aria-hidden />
                {t('group.quiet', { count: section.mails.length })}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="text-muted-foreground px-4 pb-2 text-xs">{t('group.quietHint')}</p>
                <ul className="flex flex-col px-1 py-0.5">{section.mails.map((mail) => row(mail))}</ul>
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
