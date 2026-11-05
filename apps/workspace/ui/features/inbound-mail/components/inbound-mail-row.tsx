'use client'

/**
 * One mail in the E-Mail-Eingang's list (`InboundMailRow`, DECISION §9).
 *
 * Connected, never a pill: an `Item`, so the list owns the hairlines and the
 * corners, and the open row (`data-current`) and the keyboard's row
 * (`data-cursor`) take the kit's marks rather than a bar down the edge. A
 * leading checkbox for bulk work, visible on hover and focus and always under
 * a finger; then the sender's disc, the subject with its „AW:“/„WG:“ chain
 * stripped (the full subject is in the title), the time, and one muted line:
 * who, from which domain, how many attachments. While a mail waits, a third
 * line names the E-Mail-Verlauf it would continue (only one the reader may
 * read; not under a thread group's header, which says it already, nor once a
 * follow appended the text) and a glyph says when the sender is not confirmed.
 *
 * A waiting mail is „Bereit“ or needs the person (`isReady`, the server's
 * `incompleteReason`). A ready row outside a thread group carries „Wie
 * vorgeschlagen ablegen“, one press through the same rule and request as the
 * bulk bar; a row that needs the person says what, in a few plain words. A
 * mail that names a member whose domain did not confirm it is phrased for its
 * reader (`mailClaimOf`): the member is asked „Haben Sie sie gesendet?“, a
 * colleague reads whom it waits for. A verified writer's mail direct filing
 * left says so, beside what it still needs. A handled mail says what became
 * of it and until when it can be restored.
 *
 * Metadata only: the list never carries a mail's text (D22).
 */

import type { JSX } from 'react'
import Link from 'next/link'
import { Bot, CircleDashed, FileInput, LoaderCircle, Paperclip, Repeat2, ShieldAlert } from 'lucide-react'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { BusyButton } from '@/components/ui/busy-button'
import { Checkbox } from '@/components/ui/checkbox'
import { FactLine } from '@/components/ui/fact-line'
import { Item } from '@/components/ui/item'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'
import { formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { displaySubject } from '@/lib/inbound-mail/subject'
import { fileableReason } from '../lib/completeness'
import { bulkSelectable } from '../lib/impersonation'
import { mailClaimOf } from '../lib/sender'
import { SenderTrustGlyph } from './sender-trust'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface InboundMailRowProps {
  mail: InboundMailSummaryView
  href: string
  /** This mail is open in the detail. */
  open: boolean
  /** The keyboard's row (J/K). */
  focused: boolean
  /** Checked for a bulk action. */
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** The list is selecting: checkboxes stay visible on every row. */
  selecting: boolean
  onFocusRow?: () => void
  /** Under a thread group's header: the header names the thread, so the row does not. */
  inGroup?: boolean
  /** „Wie vorgeschlagen ablegen“ for this one mail; offered only on a ready row outside a group. */
  onFileAsSuggested?: () => void
  /** That press is in flight. */
  filingAsSuggested?: boolean
}

export function InboundMailRow({
  mail,
  href,
  open,
  focused,
  checked,
  onCheckedChange,
  selecting,
  onFocusRow,
  inGroup = false,
  onFileAsSuggested,
  filingAsSuggested = false,
}: InboundMailRowProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const subject = displaySubject(mail.subject) ?? t('row.noSubject')
  const who = mail.senderName?.trim() || mail.senderDomain || '—'
  const waiting = mail.status === 'waiting'
  const outcomes = (['filed', 'dismissed', 'expired'] as const).filter((outcome) => mail.outcomes[outcome] > 0)
  // A follow appended the text; its attachments still wait for a person (D31).
  const textFollowed = waiting && mail.followedBy !== null
  // A mail posing as someone is said in words on its row, and never joins a bulk decision.
  const impersonating = mail.riskLevel === 'impersonation'
  // Every part is decided and on its way (`filing`): the row says so, and offers nothing a second press would repeat.
  const filingNow = waiting && mail.waitingParts === 0 && !impersonating
  // Why it is not „Bereit“, the server's reason; null when one press files it as suggested.
  const reason = waiting && !filingNow ? fileableReason(mail) : null
  const claim = mailClaimOf(mail)
  // The reason line in the reader's terms: the claimed member's question, whom a colleague waits for, or what it needs.
  const reasonLine = filingNow
    ? { key: 'filing', text: t('row.filing') }
    : claim === 'colleague'
      ? { key: 'claimed', text: t('row.claim.colleague', { name: who }) }
      : claim === 'own' && reason === 'sender'
        ? { key: 'own', text: t('row.claim.own') }
        : mail.waitReason === 'not_filed'
          ? { key: 'not_filed', text: reason ? t('row.notFiled', { need: t(`row.needs.${reason}`) }) : t('row.notFiledReady') }
          : reason !== null
            ? { key: reason, text: t(`row.needs.${reason}`) }
            : null
  const offerFile = waiting && !filingNow && reason === null && !inGroup && onFileAsSuggested !== undefined

  return (
    <Item
      as="li"
      // The open row is a fill, not a drawn box: the selected hairline the kit's `Item` gives it is turned off here.
      className="group/row relative items-start px-3 sm:px-4 pointer-coarse:min-h-11 data-current:bg-accent data-current:inset-ring-0"
      data-mail-id={mail.id}
      data-testid={`inbound-mail-row-${mail.id}`}
      data-open={open || undefined}
      data-focused={focused || undefined}
      // The open row lifts to the card with the selected hairline; the keyboard's row wears its ring (`Item`).
      data-current={open || undefined}
      data-cursor={(focused && !open) || undefined}
    >
      {/* Above the link's full-row press area, so a tap on the box selects instead of opening. */}
      <div className="relative z-10 flex h-8 w-4 shrink-0 items-center">
        {bulkSelectable(mail) && (
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            aria-label={t('row.select', { subject })}
            data-testid="inbound-mail-row-checkbox"
            className={cn(
              'transition-opacity duration-quick ease-out motion-reduce:transition-none',
              !selecting && !checked && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'
            )}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Link
          href={href}
          onFocus={onFocusRow}
          aria-current={open ? 'page' : undefined}
          data-testid="inbound-mail-row-link"
          className="flex min-w-0 flex-1 items-start gap-3 rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/60"
        >
          {/* A sender is not a member: one neutral disc, no identity hue (colour here would mean nothing). */}
          <PersonAvatar
            person={{ userId: mail.senderDomain ?? who, name: who }}
            size="sm"
            className="mt-0.5 shrink-0 [&_[data-slot=avatar-fallback]]:!bg-muted [&_[data-slot=avatar-fallback]]:!text-muted-foreground"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <p className={cn('min-w-0 flex-1 truncate text-sm', waiting ? 'text-foreground font-medium' : 'text-muted-foreground')} title={mail.subject ?? undefined}>
                {subject}
              </p>
              <TimeAgo date={mail.receivedAt} locale={locale} className="text-muted-foreground shrink-0 text-xs tabular-nums" />
            </div>
            <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              {mail.automatic ? <Bot className="size-3.5 shrink-0" aria-label={t('row.automatic')} /> : <SenderTrustGlyph trust={mail.senderTrust} flags={mail.senderFlags} impersonation={mail.impersonation} claim={claim} />}
              <span className="min-w-0 truncate">
                {who}
                {mail.senderDomain && mail.senderName && <span> · {mail.senderDomain}</span>}
              </span>
              {mail.attachments > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1">
                  <span aria-hidden>·</span>
                  <Paperclip className="size-3" aria-hidden />
                  {t('row.attachments', { count: mail.attachments })}
                </span>
              )}
            </p>
            {/* A stop: the signal red on the glyph, the words in ink (`FactLine`), and never cut off. */}
            {waiting && impersonating && (
              <FactLine icon={ShieldAlert} tone="danger" testId="inbound-mail-row-impersonation">
                {claim === 'own' ? t('row.impersonationOwn') : t('row.impersonation', { name: who })}
              </FactLine>
            )}
            {waiting && reasonLine && !impersonating && (
              <p className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs" data-testid="inbound-mail-row-reason" data-reason={reasonLine.key}>
                {filingNow ? (
                  <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <CircleDashed className="size-3 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 truncate">{reasonLine.text}</span>
              </p>
            )}
            {waiting && mail.thread && !inGroup && !textFollowed && (
              <p
                className="text-muted-foreground min-w-0 truncate text-xs"
                data-testid="inbound-mail-row-thread"
                title={t('row.thread', { name: mail.thread.name, version: mail.thread.nextVersion })}
              >
                <span aria-hidden>→ </span>
                {t('row.thread', { name: mail.thread.name, version: mail.thread.nextVersion })}
              </p>
            )}
            {textFollowed && (
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <Repeat2 className="size-3" aria-hidden />
                {t('row.textFollowed')}
              </p>
            )}
            {!waiting && outcomes.length > 0 && (
              <p className="text-muted-foreground text-xs" data-testid="inbound-mail-row-outcome">
                {outcomes.map((outcome) => t(`row.outcome.${outcome}`, { count: mail.outcomes[outcome] })).join(' · ')}
                {mail.restorableUntil && ` · ${t('row.restorableUntil', { date: formatCalendarDate(mail.restorableUntil, locale) })}`}
              </p>
            )}
          </div>
        </Link>
        {offerFile && (
          // Above the link's full-row press area, like the checkbox; aligned with the text column, past the disc.
          // Offered where the reader is: on the open row, under the pointer or the keyboard, and always under a finger.
          // Nine rows with nine buttons was a column of competing presses beside the detail's one primary.
          <div className="relative z-10 hidden pl-10 group-hover/row:block group-focus-within/row:block group-data-[current]/row:block pointer-coarse:block">
            <BusyButton
              type="button"
              size="sm"
              variant="outline"
              // `h-7` on a mouse; under a finger the kit's 44px, as the row's link sits right behind it.
              className="h-7 px-2.5 text-xs"
              busy={filingAsSuggested}
              busyLabel={t('bulk.fileSuggestedBusy')}
              icon={<FileInput aria-hidden />}
              onClick={onFileAsSuggested}
              aria-label={t('row.fileAsSuggested', { subject })}
              data-testid="inbound-mail-row-file"
            >
              {t('bulk.fileSuggested')}
            </BusyButton>
          </div>
        )}
      </div>
    </Item>
  )
}
