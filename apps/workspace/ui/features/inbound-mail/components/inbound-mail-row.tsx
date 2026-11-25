'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { Bot, CircleAlert, Hourglass, LoaderCircle, ShieldAlert } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Item } from '@/components/ui/item'
import { ListTime } from './list-time'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'
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
  groupThread?: string
  now?: number
}

const dayMonth = (iso: string, locale: string): string => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(iso))

/** Two lines, as every list row: the subject and its time, then who sent it and the one thing that decides it. */
export function InboundMailRow({ mail, href, open, focused, checked, onCheckedChange, selecting, onFocusRow, inGroup = false, groupThread, now }: InboundMailRowProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const shown = displaySubject(mail.subject)
  const waiting = mail.status === 'waiting'
  const subject = (inGroup && mail.thread ? subjectWithinThread(shown, mail.thread.name) : shown) ?? (!waiting ? mail.filedTo?.name : undefined) ?? t('row.noSubject')
  const who = mail.senderName?.trim() || mail.senderDomain || (waiting ? '—' : null)
  const impersonating = mail.riskLevel === 'impersonation'
  const filingNow = waiting && mail.waitingParts === 0 && !impersonating
  const reason = waiting && !filingNow ? fileableReason(mail) : null
  const claim = mailClaimOf(mail)
  const reasonLine =
    claim === 'colleague'
      ? { key: 'claimed', text: t('row.claim.colleague', { name: who ?? '—' }) }
      : claim === 'own' && reason === 'sender'
        ? { key: 'own', text: t('row.claim.own') }
        : mail.waitReason === 'not_filed'
          ? { key: 'not_filed', text: reason ? t('row.notFiled', { need: t(`row.needs.${reason}`) }) : t('row.notFiledReady') }
          : reason !== null
            ? { key: reason, text: t(`row.needs.${reason}`) }
            : null
  const expiresSoon = waiting && now !== undefined && !filingNow && !impersonating && daysUntilExpiry(mail, now) !== null
  const pickable = selecting && waiting && bulkSelectable(mail)
  const status = rowStatus({ mail, waiting, impersonating, filingNow, reasonLine, claim, who, groupThread, t })
  const expiry = expiresSoon ? t('row.expiresShort', { date: dayMonth(mail.expiresAt, locale) }) : null

  return (
    <Item
      as="li"
      className={cn('group/row items-start rounded-control px-3 py-2.5 hover:bg-hover pointer-coarse:min-h-11 data-current:bg-selected data-current:hover:bg-selected data-current:inset-ring-0', checked && 'bg-selected hover:bg-hover [&:has(+[data-checked])]:rounded-b-none [[data-checked]+&]:rounded-t-none', open && !checked && '[&:has(+[data-checked])]:mb-1 [[data-checked]+&]:mt-1')}
      data-checked={checked || undefined}
      data-filled={checked || open || undefined}
      data-mail-id={mail.id}
      data-testid={`inbound-mail-row-${mail.id}`}
      data-open={open || undefined}
      data-focused={focused || undefined}
      data-current={open || undefined}
      data-cursor={(focused && !open) || undefined}
    >
      <div className={cn('relative z-10 flex h-[21px] w-4 shrink-0 items-center', !(waiting && selecting) && 'hidden')}>
        {waiting && selecting && bulkSelectable(mail) && (
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            aria-label={t('row.select', { subject })}
            data-testid="inbound-mail-row-checkbox"
          />
        )}
      </div>
      <Link
        href={href}
        onFocus={onFocusRow}
        onClick={(event) => {
          if (!pickable) return
          event.preventDefault()
          onCheckedChange(!checked)
          const pressedByPointer = event.detail > 0
          if (pressedByPointer) event.currentTarget.blur()
        }}
        aria-current={open ? 'page' : undefined}
        data-testid="inbound-mail-row-link"
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-inline outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/60"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-name', waiting ? 'text-foreground font-medium' : 'text-foreground font-normal')} title={mail.subject ?? undefined}>
            {subject}
          </span>
          {expiry ? (
            <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs tabular-nums" data-testid="inbound-mail-row-expiry">
              <Hourglass className="text-warning size-3" aria-hidden />
              {expiry}
            </span>
          ) : (
            <ListTime date={mail.receivedAt} locale={locale} />
          )}
        </span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          {who !== null && (mail.automatic ? <Bot className="size-3.5 shrink-0" aria-label={t('row.automatic')} /> : !senderVouched(mail) && <SenderTrustGlyph trust={mail.senderTrust} flags={mail.senderFlags} impersonation={mail.impersonation} claim={claim} name={mail.senderName} />)}
          {who !== null && <span className="min-w-0 shrink truncate">{who}</span>}
          {who !== null && status && <span aria-hidden>·</span>}
          {status && (
            <span className={cn('inline-flex min-w-0 shrink-0 items-center gap-1 truncate', STATUS_TONE[status.tone])} data-testid={status.testId} data-reason={status.key}>
              {status.tone === 'busy' && <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
              {status.tone === 'danger' && <ShieldAlert className="size-3 shrink-0" aria-hidden />}
              {status.tone === 'warning' && <CircleAlert className="size-3 shrink-0" aria-hidden />}
              <span className="truncate">{status.text}</span>
            </span>
          )}
        </span>
      </Link>
    </Item>
  )
}

/** A sender the server vouches for needs no glyph: the glyph speaks only when something about the sender is off. */
const senderVouched = (mail: InboundMailSummaryView): boolean =>
  (mail.senderTrust === 'member_verified' || mail.senderTrust === 'external_verified') && mail.riskLevel !== 'impersonation' && mail.impersonation === null && mail.senderFlags.length === 0

type StatusTone = 'quiet' | 'warning' | 'danger' | 'busy'
const STATUS_TONE: Record<StatusTone, string> = {
  quiet: 'text-muted-foreground',
  warning: 'text-foreground [&>svg]:text-warning',
  danger: 'text-foreground [&>svg]:text-error',
  busy: 'text-muted-foreground',
}

interface RowStatus {
  key: string
  text: string
  tone: StatusTone
  testId: string
}

function rowStatus(input: {
  mail: InboundMailSummaryView
  waiting: boolean
  impersonating: boolean
  filingNow: boolean
  reasonLine: { key: string; text: string } | null
  claim: ReturnType<typeof mailClaimOf>
  who: string | null
  groupThread?: string
  t: Translator
}): RowStatus | null {
  const { mail, waiting, impersonating, filingNow, reasonLine, claim, who, groupThread, t } = input
  if (!waiting && mail.filedWithoutClick) {
    const to = mail.filedWithoutClick.to
    return { key: 'auto', text: to ? t('autoFiled.row', { place: to.name }) : t('autoFiled.rowNoPlace'), tone: 'quiet', testId: 'inbound-mail-row-filed-without-click' }
  }
  if (!waiting) {
    const outcome = (['filed', 'dismissed', 'expired'] as const).find((name) => mail.outcomes[name] > 0)
    if (!outcome) return null
    const filedName = mail.filedTo?.name
    const text = outcome === 'filed' && filedName ? t('row.filedTo', { name: filedName }) : t(`row.outcome.${outcome}`, { count: mail.outcomes[outcome] })
    return { key: outcome, text, tone: 'quiet', testId: 'inbound-mail-row-outcome' }
  }
  if (impersonating) {
    return { key: 'impersonation', text: claim === 'own' ? t('row.impersonationOwn') : t('row.impersonation', { name: who ?? '—' }), tone: 'danger', testId: 'inbound-mail-row-impersonation' }
  }
  if (filingNow) return { key: 'filing', text: t('row.filing'), tone: 'busy', testId: 'inbound-mail-row-reason' }
  if (reasonLine) return { key: reasonLine.key, text: reasonLine.text, tone: 'warning', testId: 'inbound-mail-row-reason' }
  const place = destinationLine(mail.suggestedPlaces, groupThread, t)
  return place ? { key: 'places', text: place, tone: 'quiet', testId: 'inbound-mail-row-places' } : null
}

function destinationLine(places: InboundMailSummaryView['suggestedPlaces'], groupThread: string | undefined, t: Translator): string | null {
  if (!places) return null
  const folders = places.files > 0 ? places.folders.map((folder) => (folder === '' ? t('suggestion.root') : folder)) : []
  const text = places.text?.kind === 'thread' && places.text.name !== groupThread ? t('row.quoted', { name: places.text.name }) : places.text?.kind === 'new_thread' ? t('row.destNewThread') : null
  const all = [...folders, ...(text ? [text] : [])]
  if (all.length === 0) return groupThread ? t('row.dest', { place: t('row.quoted', { name: groupThread }) }) : null
  return all.length === 1 ? t('row.dest', { place: all[0] }) : t('row.destMore', { place: all[0], count: all.length - 1 })
}
