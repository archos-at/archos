'use client'

import type { JSX } from 'react'
import { Clock, Info, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { Toggletip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useTranslations } from '@/i18n'
import type { InboundMailSenderView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import {
  INBOUND_MAIL_EXPIRING_NOTICE_DAYS,
  INBOUND_MAIL_STALE_DATE_DAYS,
  type ImpersonationBasis,
  type InboundSenderTrust,
  type SenderFlag,
} from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  senderDisplayName,
  senderFlagLines,
  senderTone,
  senderTrustLine,
  trustTechnical,
  type MailClaim,
  type SenderTone,
  type SenderTrustLine,
} from '../lib/sender'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const explainKey = (line: SenderTrustLine, claim: MailClaim): string => {
  switch (line.kind) {
    case 'verified':
      return 'verified'
    case 'bcc_own':
      return 'bccOwn'
    case 'own_rejected':
      return 'impersonationOwn'
    case 'impersonation':
      return line.basis === 'member_name' ? 'impersonationMemberName' : 'impersonation'
    case 'member_unverified':
      return line.own ? 'memberUnverifiedOwn' : claim === 'colleague' ? 'memberUnverifiedClaimed' : 'memberUnverified'
    case 'unverified':
      return 'unverified'
  }
}

export function useTrustLabel(): (line: SenderTrustLine) => string {
  const t = useTranslations(inboundMailCopy)
  return (line) => {
    switch (line.kind) {
      case 'verified':
        return t('trust.verified')
      case 'bcc_own':
        return t('trust.bccOwn')
      case 'impersonation':
        return t('trust.impersonation')
      case 'own_rejected':
        return t('trust.impersonationOwn')
      case 'member_unverified':
        return line.own ? t('trust.memberUnverifiedOwn') : t('trust.memberUnverified', { name: line.name })
      case 'unverified':
        return t('trust.unverified')
    }
  }
}

const GLYPH: Record<SenderTone, typeof ShieldCheck> = { confirmed: ShieldCheck, neutral: ShieldQuestion, danger: ShieldAlert }

/** Colour is a verdict: red only for a forgery; an address nobody can vouch for is the normal case of a small office. */
const GLYPH_TONE: Record<SenderTone, string> = { confirmed: 'text-foreground', neutral: 'text-muted-foreground', danger: 'text-error' }

export function SenderTrustGlyph({
  trust,
  flags,
  impersonation,
  claim = null,
  name = null,
}: {
  trust: InboundSenderTrust | null
  flags: SenderFlag[]
  impersonation: ImpersonationBasis | null
  claim?: MailClaim
  name?: string | null
}): JSX.Element | null {
  const label = useTrustLabel()
  const verified = trust === 'member_verified' || trust === 'external_verified'
  const line = senderTrustLine({
    trust: trust ?? 'external_unverified',
    reason: verified ? 'dkim_pass' : 'dkim_none',
    flags,
    name,
    address: '',
    domain: null,
    signerDomain: null,
  }, impersonation, claim)
  const tone = senderTone(line)
  if (tone === 'confirmed') return null
  const Icon = GLYPH[tone]
  return (
    <span
      role="img"
      aria-label={label(line)}
      title={label(line)}
      data-testid="sender-trust-glyph"
      data-tone={tone}
      className={cn('inline-flex shrink-0', GLYPH_TONE[tone])}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
    </span>
  )
}

export function SenderTrustLine({
  sender,
  impersonation,
  claim = null,
}: {
  sender: InboundMailSenderView
  impersonation: ImpersonationBasis | null
  claim?: MailClaim
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const label = useTrustLabel()
  const line = senderTrustLine(sender, impersonation, claim)
  const tone = senderTone(line)
  const domain = line.kind === 'verified' ? line.domain : (sender.domain ?? '')
  const explain = t(`trust.explain.${explainKey(line, claim)}`, { name: senderDisplayName(sender), domain })
  const Icon = GLYPH[tone]
  return (
    <span className="text-foreground inline-flex min-w-0 items-start gap-1.5 text-xs font-medium" data-testid="sender-trust" data-tone={tone}>
      <Icon aria-hidden className={cn('mt-px size-3.5 shrink-0', GLYPH_TONE[tone])} />
      {/* The ⓘ follows the last word: as a flex item of its own it stood at the far edge once the words wrapped. */}
      <span className="min-w-0 [overflow-wrap:break-word]">
        {label(line)}{' '}
        <Toggletip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground touch-target inline-flex size-4 shrink-0 items-center justify-center rounded-inline align-[-3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label={explain}
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{explain}</TooltipContent>
        </Toggletip>
      </span>
    </span>
  )
}

export function SenderTrustTechnical({ sender, impersonation, claim = null }: { sender: InboundMailSenderView; impersonation: ImpersonationBasis | null; claim?: MailClaim }): string {
  const t = useTranslations(inboundMailCopy)
  const technical = trustTechnical(sender, senderTrustLine(sender, impersonation, claim))
  return technical.kind === 'memberName'
    ? t('trust.technical.memberName', { address: technical.address })
    : t(`trust.technical.${technical.kind}`, { domain: technical.domain })
}

const ASKED_OF_THE_WRITER: ReadonlySet<string> = new Set(['signature', 'replay', 'automatic'])
const ASKS_A_CHECK: ReadonlySet<string> = new Set(['signature', 'replay', 'automatic', 'sender_unchecked'])
/** The pane says why a mail waits only where the reader has something to do, or the mail will be gone: everything else waits for a filing anyway. */
const SAID_IN_THE_PANE: ReadonlySet<string> = new Set([...ASKS_A_CHECK, 'outside_office'])

export function SenderWaitLine({
  view,
  expirySoon = false,
}: {
  view: Pick<InboundMailView, 'status' | 'waitReason' | 'ownClaimedMail'> & Partial<Pick<InboundMailView, 'riskLevel' | 'sender' | 'parts' | 'expiresAt'>>
  expirySoon?: boolean
}): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  if (view.status !== 'waiting' || !view.waitReason || view.riskLevel === 'impersonation' || !SAID_IN_THE_PANE.has(view.waitReason)) return null
  if (view.parts && !view.parts.some((part) => part.state === 'waiting')) return null
  if (view.waitReason === 'outside_office' && (expirySoon || !view.expiresAt)) return null
  const key = ASKED_OF_THE_WRITER.has(view.waitReason) && view.ownClaimedMail ? `${view.waitReason}Own` : view.waitReason
  const name = view.sender ? senderDisplayName(view.sender) : ''
  const asks = ASKS_A_CHECK.has(view.waitReason)
  const quiet = view.waitReason === 'outside_office'
  return (
    <p
      className={cn('flex items-start gap-1.5 text-xs', quiet ? 'text-muted-foreground' : 'text-foreground')}
      data-testid="sender-wait-reason"
      data-reason={key}
      data-asks={asks || undefined}
    >
      <Clock className={cn('mt-px size-3.5 shrink-0', asks ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
      <span className="min-w-0 max-w-[64ch] [overflow-wrap:anywhere]" /* a measure: across a 750px reader it ran two lines of 120 characters */>
        {t(`waitReason.${key}`, {
          name,
          date: view.expiresAt ? formatCalendarDate(view.expiresAt, locale) : '',
          reminderDays: INBOUND_MAIL_EXPIRING_NOTICE_DAYS,
        })}
      </span>
    </p>
  )
}

export function SenderFlagLines({ sender }: { sender: InboundMailSenderView }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const flags = senderFlagLines(sender)
  if (flags.length === 0) return null
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="sender-flags">
      {flags.map((flag) => (
        <p key={flag} className="text-foreground flex items-center gap-1.5 font-medium" data-testid={`sender-flag-${flag}`}>
          <ShieldAlert className="text-warning size-3.5 shrink-0" aria-hidden />
          <span>{t(`flags.${flag}`, { days: INBOUND_MAIL_STALE_DATE_DAYS })}</span>
        </p>
      ))}
    </div>
  )
}
