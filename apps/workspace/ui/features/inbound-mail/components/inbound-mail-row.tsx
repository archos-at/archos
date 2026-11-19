'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { Bot, CircleAlert, FileInput, Hourglass, LoaderCircle, Mails, Paperclip, ShieldAlert } from 'lucide-react'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { BusyButton } from '@/components/ui/busy-button'
import { Checkbox } from '@/components/ui/checkbox'
import { FactLine } from '@/components/ui/fact-line'
import { Item } from '@/components/ui/item'
import { ROW_HAIRLINE } from '@/components/ui/row-hairline'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'
import { CLAUSE_JOIN, formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { displaySubject, subjectWithinThread } from '@/lib/inbound-mail/subject'
import { fileableReason } from '../lib/completeness'
import { bulkSelectable } from '../lib/impersonation'
import { daysUntilExpiry } from '../lib/list-sections'
import { mailClaimOf } from '../lib/sender'
import { SenderTrustGlyph } from './sender-trust'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface InboundMailRowProps {
  mail: InboundMailSummaryView
  href: string
  open: boolean
  focused: boolean
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  selecting: boolean
  onFocusRow?: () => void
  inGroup?: boolean
  onFileAsSuggested?: () => void
  filingAsSuggested?: boolean
  now?: number
}

export function InboundMailRow({
  mail,
  href,
  open,
  focused,
  checked,
  onCheckedChange,
  onFocusRow,
  inGroup = false,
  onFileAsSuggested,
  filingAsSuggested = false,
  now,
}: InboundMailRowProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const shown = displaySubject(mail.subject)
  const subject = (inGroup && mail.thread ? subjectWithinThread(shown, mail.thread.name) : shown) ?? t('row.noSubject')
  const who = mail.senderName?.trim() || mail.senderDomain || '—'
  const waiting = mail.status === 'waiting'
  const outcomes = (['filed', 'dismissed', 'expired'] as const).filter((outcome) => mail.outcomes[outcome] > 0)
  const textFollowed = waiting && mail.followedBy !== null
  const impersonating = mail.riskLevel === 'impersonation'
  const filingNow = waiting && mail.waitingParts === 0 && !impersonating
  const reason = waiting && !filingNow ? fileableReason(mail) : null
  const claim = mailClaimOf(mail)
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
  const expiresInDays = now === undefined || filingNow || impersonating ? null : daysUntilExpiry(mail, now)
  const expiryText = expiresInDays === null ? null : expiresInDays === 0 ? t('row.expiresToday') : t('row.expiresIn', { days: expiresInDays })
  const offerFile = waiting && !filingNow && reason === null && !inGroup && onFileAsSuggested !== undefined
  const needsReader = waiting && !filingNow && reason !== null && claim !== 'colleague'

  return (
    <Item
      as="li"
      className={cn('group/row items-start rounded-control px-3 py-2.5 [--row-end:12px] hover:bg-hover pointer-coarse:min-h-11 data-current:bg-sheet data-current:shadow-sm data-current:inset-ring-0 dark:data-current:shadow-sheet-pointer' /* in dark the open sheet stood 1.3:1 off the desk with a 16% edge; the field's border (3.2:1) is its edge, as the thumb's */, ROW_HAIRLINE, waiting ? '[--row-text:80px]' : '[--row-text:52px]', checked && 'bg-selected hover:bg-hover [&:has(+[data-checked])]:rounded-b-none [[data-checked]+&]:rounded-t-none', open && !checked && '[&:has(+[data-checked])]:mb-1 [[data-checked]+&]:mt-1' /* 4px between the open row's sheet and a picked run: three fills fused into one block */)}
      data-checked={checked || undefined}
      data-filled={checked || open || undefined}
      data-mail-id={mail.id}
      data-testid={`inbound-mail-row-${mail.id}`}
      data-open={open || undefined}
      data-focused={focused || undefined}
      data-current={open || undefined}
      data-cursor={(focused && !open) || undefined}
    >
      {/* Above the link's full-row press area, so a tap on the box selects instead of opening. No column in the handled
          list, where nothing is filed or dismissed in bulk: an empty 28px gutter read as an indent under a thread. */}
      <div className={cn('relative z-10 flex h-8 w-4 shrink-0 items-center', !waiting && 'hidden')}>
        {waiting && bulkSelectable(mail) && (
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            aria-label={t('row.select', { subject })}
            data-testid="inbound-mail-row-checkbox"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Link
          href={href}
          onFocus={onFocusRow}
          aria-current={open ? 'page' : undefined}
          data-testid="inbound-mail-row-link"
          className="flex min-w-0 flex-1 items-start gap-3 rounded-inline outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/60"
        >
          {/* A sender is not a member: one neutral disc, no identity hue (colour here would mean nothing). The one
              grey on the page; white on the row's hover and open fill, as anything on a grey surface is. */}
          <PersonAvatar
            person={{ userId: mail.senderDomain ?? who, name: who }}
            size="sm"
            className="mt-0.5 shrink-0 [&_[data-slot=avatar-fallback]]:!bg-sheet [&_[data-slot=avatar-fallback]]:!text-muted-foreground group-hover/row:[&_[data-slot=avatar-fallback]]:!bg-background group-data-current/row:[&_[data-slot=avatar-fallback]]:!bg-background group-data-checked/row:[&_[data-slot=avatar-fallback]]:!bg-background"
          />
          <div className="flex min-w-0 flex-1 flex-col" /* a name and one meta line: 56px with the row's 10px */>
            <div className="flex min-w-0 items-baseline gap-2">
              <p className={cn('min-w-0 flex-1 line-clamp-2 text-name text-pretty [overflow-wrap:anywhere]', needsReader ? 'text-foreground font-semibold' : waiting ? 'text-foreground font-medium' : 'text-foreground font-normal')} title={mail.subject ?? undefined} /* a handled mail reads in ink at the normal weight: the tab says it is done, grey made every row read disabled */>
                {subject}
              </p>
              <TimeAgo date={mail.receivedAt} locale={locale} className="text-muted-foreground shrink-0 text-xs tabular-nums" />
            </div>
            <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              {mail.automatic ? <Bot className="size-3.5 shrink-0" aria-label={t('row.automatic')} /> : <SenderTrustGlyph trust={mail.senderTrust} flags={mail.senderFlags} impersonation={mail.impersonation} claim={claim} />}
              <span className="min-w-0 truncate">
                {who}
                {mail.senderDomain && mail.senderName && <span>{CLAUSE_JOIN}{mail.senderDomain}</span>}
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
                  <CircleAlert className="text-warning size-3 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 truncate">
                  {reasonLine.text}
                  {expiryText && <span data-testid="inbound-mail-row-expiry">{CLAUSE_JOIN}{expiryText}</span>}
                </span>
              </p>
            )}
            {waiting && !reasonLine && !impersonating && expiryText && (
              <p className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs" data-testid="inbound-mail-row-expiry">
                <Hourglass className="text-warning size-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{expiryText}</span>
              </p>
            )}
            {waiting && mail.thread && !inGroup && !textFollowed && (
              <p
                className="text-muted-foreground min-w-0 text-xs text-pretty [overflow-wrap:anywhere]"
                data-testid="inbound-mail-row-thread"
                title={t('row.thread', { name: mail.thread.name, version: mail.thread.nextVersion })}
              >
                <span aria-hidden>→ </span>
                {t('row.thread', { name: mail.thread.name, version: mail.thread.nextVersion })}
              </p>
            )}
            {textFollowed && (
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <Mails className="size-3" aria-hidden />
                {t('row.textFollowed')}
              </p>
            )}
            {!waiting && outcomes.length > 0 && (
              <p className="text-muted-foreground text-xs text-pretty" data-testid="inbound-mail-row-outcome" /* no date stranded on a line of its own */>
                {outcomes.map((outcome) => t(`row.outcome.${outcome}`, { count: mail.outcomes[outcome] })).join(CLAUSE_JOIN)}
                {mail.restorableUntil && `${CLAUSE_JOIN}${t('row.restorableUntil', { date: formatCalendarDate(mail.restorableUntil, locale) })}`}
              </p>
            )}
          </div>
        </Link>
        {offerFile && (
          <div className="relative z-10 hidden pl-10 group-data-[current]/row:block pointer-fine:group-hover/row:block pointer-fine:group-focus-within/row:block" /* under a finger only on the open row: one stray tap filed a mail */>
            <BusyButton
              type="button"
              size="sm"
              variant="secondary"
              className="px-2.5 text-xs"
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
