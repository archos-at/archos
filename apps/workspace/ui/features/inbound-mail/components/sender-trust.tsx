'use client'

import type { JSX } from 'react'
import { Clock, Info, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { Toggletip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import type { InboundMailSenderView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { INBOUND_MAIL_EXTERNAL_WAIT_DAYS, INBOUND_MAIL_STALE_DATE_DAYS, type ImpersonationBasis, type InboundSenderTrust, type SenderFlag } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { cn } from '@/lib/utils'
import { senderDisplayName, senderFlagLines, senderTone, senderTrustLine, type MailClaim, type SenderTrustLine } from '../lib/sender'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const KEY: Record<SenderTrustLine['kind'], string> = {
  verified: 'verified',
  bcc_own: 'bccOwn',
  member_unverified: 'memberUnverified',
  impersonation: 'impersonation',
  own_rejected: 'impersonationOwn',
  unverified: 'unverified',
}

const explainKey = (line: SenderTrustLine, claim: MailClaim): string => {
  if (line.kind === 'impersonation' && line.basis === 'member_name') return 'impersonationMemberName'
  if (line.kind === 'member_unverified' && claim === 'own') return 'memberUnverifiedOwn'
  if (line.kind === 'member_unverified' && claim === 'colleague') return 'memberUnverifiedClaimed'
  return KEY[line.kind]
}

export function useTrustLabel(): (line: SenderTrustLine) => string {
  const t = useTranslations(inboundMailCopy)
  return (line) => {
    switch (line.kind) {
      case 'verified':
        return t('trust.verified', { domain: line.domain })
      case 'bcc_own':
        return t('trust.bccOwn')
      case 'impersonation':
        return t('trust.impersonation', { name: line.name })
      case 'own_rejected':
        return t('trust.impersonationOwn')
      case 'member_unverified':
        return t('trust.memberUnverified')
      case 'unverified':
        return t('trust.unverified')
    }
  }
}

function TrustGlyph({ line, className }: { line: SenderTrustLine; className?: string }): JSX.Element {
  const tone = senderTone(line)
  const Icon = tone === 'confirmed' ? ShieldCheck : tone === 'warning' ? ShieldAlert : ShieldQuestion
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />
}

export function SenderTrustGlyph({
  trust,
  flags,
  impersonation,
  claim = null,
}: {
  trust: InboundSenderTrust | null
  flags: SenderFlag[]
  impersonation: ImpersonationBasis | null
  claim?: MailClaim
}): JSX.Element | null {
  const label = useTrustLabel()
  const verified = trust === 'member_verified' || trust === 'external_verified'
  const line = senderTrustLine({
    trust: trust ?? 'external_unverified',
    reason: verified ? 'dkim_pass' : 'dkim_none',
    flags,
    name: null,
    address: '',
    domain: null,
    signerDomain: null,
  }, impersonation, claim)
  const tone = senderTone(line)
  if (tone === 'confirmed') return null
  return (
    <span
      role="img"
      aria-label={label(line)}
      title={label(line)}
      data-testid="sender-trust-glyph"
      data-tone={tone}
      className={cn('inline-flex shrink-0', tone === 'warning' ? 'text-warning' : 'text-muted-foreground')}
    >
      <TrustGlyph line={line} />
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
  const explain = t(`trust.explain.${explainKey(line, claim)}`, { name: senderDisplayName(sender) })
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-start gap-1.5 text-xs [&>svg:first-child]:mt-px',
        tone === 'warning' ? 'text-foreground font-medium [&>svg:first-child]:text-warning' : tone === 'confirmed' ? 'text-foreground' : 'text-muted-foreground'
      )}
      data-testid="sender-trust"
      data-tone={tone}
    >
      <TrustGlyph line={line} />
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

const ASKED_OF_THE_WRITER: ReadonlySet<string> = new Set(['signature', 'replay', 'automatic'])

export function SenderWaitLine({
  view,
}: {
  view: Pick<InboundMailView, 'status' | 'waitReason' | 'ownClaimedMail'> & Partial<Pick<InboundMailView, 'riskLevel' | 'sender' | 'parts'>>
}): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  if (view.status !== 'waiting' || !view.waitReason || view.riskLevel === 'impersonation') return null
  if (view.parts && !view.parts.some((part) => part.state === 'waiting')) return null
  const key = ASKED_OF_THE_WRITER.has(view.waitReason) && view.ownClaimedMail ? `${view.waitReason}Own` : view.waitReason
  const name = view.sender ? senderDisplayName(view.sender) : ''
  return (
    <p className="text-foreground flex items-start gap-1.5 text-xs" data-testid="sender-wait-reason" data-reason={key}>
      <Clock className="text-warning mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 max-w-[64ch] [overflow-wrap:anywhere]" /* a measure: across a 750px reader it ran two lines of 120 characters */>{t(`waitReason.${key}`, { days: INBOUND_MAIL_EXTERNAL_WAIT_DAYS, name })}</span>
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
