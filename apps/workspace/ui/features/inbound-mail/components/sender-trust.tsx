'use client'

/**
 * How far a mail's sender is confirmed, as one line: a glyph, the words, and
 * (in the detail) a toggletip that says what the words mean. Glyph and words
 * always travel together; there is no colour that says it alone.
 *
 * Restraint is the point. A confirmed domain is a quiet fact in muted ink,
 * not a green badge: chroma in this product is provenance. Only the two
 * cases a person must not miss before filing, a member's address without
 * their domain's signature and someone posing as a member, wear the warning
 * tint, because filing them needs the person's explicit yes.
 */

import type { JSX } from 'react'
import { Info, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
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

/**
 * The toggletip's key: an impersonation says why it reads as one, and a
 * member's unconfirmed address says who may file it: the member themself
 * („Own“), or only that member, to a colleague („Claimed“).
 */
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

/**
 * The row's glyph: shown only when the sender is not confirmed, with the label
 * as its accessible name. A list row knows the trust and the flags, not the
 * DKIM reason, so it says „Mitglied · Domain nicht bestätigt“ where the detail
 * may say more.
 */
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

/**
 * The detail's trust, in the header's one line: glyph, words and the
 * toggletip that says what they mean. Trust is never folded behind „Details“:
 * it is the one fact about the sender a person reads before the text.
 */
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
        'inline-flex min-w-0 items-center gap-1.5 text-xs',
        // Gold on the glyph, ink on the words: the warning tone is under 4.5:1 as 12px text.
        tone === 'warning' ? 'text-foreground font-medium [&>svg:first-child]:text-warning' : tone === 'confirmed' ? 'text-foreground' : 'text-muted-foreground'
      )}
      data-testid="sender-trust"
      data-tone={tone}
    >
      <TrustGlyph line={line} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{label(line)}</span>
      <Toggletip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground touch-target inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label={explain}
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{explain}</TooltipContent>
      </Toggletip>
    </span>
  )
}

/**
 * The reasons a writer's own mail waits for them: each is asked of that writer
 * as „Haben Sie diese E-Mail gesendet?“. Not `paused`: with direct filing switched off a
 * verified writer's mail waits for any of the project's writers.
 */
const ASKED_OF_THE_WRITER: ReadonlySet<string> = new Set(['signature', 'replay', 'automatic'])

/**
 * Why the mail waits, by who its sender is to the project (ADR-0137's
 * amendment): a writer's mail that was not filed directly, because their
 * domain did not confirm it, it reads as re-sent or misdated, or it was sent
 * automatically (asked of that writer as „Haben Sie diese E-Mail gesendet?“, and said
 * to a colleague as whom it waits for), direct filing switched off (`paused`,
 * any writer files it), a verified writer's mail direct filing left waiting
 * (`not_filed`, any writer files it), a member who may not write here, or
 * someone outside the office. Each line ends on what the reader can do, with
 * one exception: the colleague's lines of a claimed mail (`signature`,
 * `replay`, `automatic`) say only whom it waits for and why, because
 * `ClaimedMailBar` right below already says „Sie können sie verwerfen.“ and a
 * second time would only repeat it (`design-language.md`, principle 9).
 * Nothing once nothing of it waits, or under an impersonation's warning,
 * which already says why and what to do.
 */
export function SenderWaitLine({
  view,
}: {
  view: Pick<InboundMailView, 'status' | 'waitReason' | 'onlySenderReleases'> & Partial<Pick<InboundMailView, 'riskLevel' | 'sender'>>
}): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  if (view.status !== 'waiting' || !view.waitReason || view.riskLevel === 'impersonation') return null
  const key = ASKED_OF_THE_WRITER.has(view.waitReason) && !view.onlySenderReleases ? `${view.waitReason}Own` : view.waitReason
  const name = view.sender ? senderDisplayName(view.sender) : ''
  return (
    <p className="text-muted-foreground flex items-start gap-1.5 text-xs" data-testid="sender-wait-reason" data-reason={key}>
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{t(`waitReason.${key}`, { days: INBOUND_MAIL_EXTERNAL_WAIT_DAYS, name })}</span>
    </p>
  )
}

/** The sender's flags that change what filing needs, each a fact with its glyph; nothing when there is none. */
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
