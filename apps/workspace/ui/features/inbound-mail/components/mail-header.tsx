'use client'

/**
 * The head of one held mail, built so the detail opens on the mail itself
 * (the owner's review, 2026-10-27): the subject, then who it is from (name
 * and address, never one without the other), then one muted line with how far
 * the sender's domain is confirmed and when it arrived, then the flags that
 * change what filing needs. Everything else is evidence a person needs now and
 * then, and sits behind „Details“ at the end of that line: when it was sent, every
 * recipient, the original `.eml` with its warning, and the date it stops
 * waiting. Trust is never folded away, and the expiry comes forward into the
 * header in its last week (`expiryShownInline`).
 *
 * The original is downloaded through a fetch, so a refusal (the whole message
 * is scanned again on every request, D6) arrives as a sentence, not as a JSON
 * file in the downloads folder. Its warning stands beside the button: it
 * opens in a mail program, which loads images from outside.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Download, Forward, Info, ShieldAlert, Timer } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Toggletip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useTranslations } from '@/i18n'
import { capturePosthog } from '@/lib/analytics/posthog'
import { downloadFetched } from '@/lib/browser-download'
import type { InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { formatAbsoluteTime, formatCalendarDate } from '@/lib/format'
import type { ForwardedOrigin } from '@/lib/inbound-mail/forwarded'
import { displaySubject } from '@/lib/inbound-mail/subject'
import { expiryShownInline } from '../lib/evidence'
import { mailClaimOf, senderDisplayName } from '../lib/sender'
import { FactLine, QuietPanel } from './inbound-mail-atoms'
import { SenderFlagLines, SenderTrustLine, SenderWaitLine } from './sender-trust'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface MailHeaderProps {
  view: InboundMailView
  forwarded: ForwardedOrigin | null
  originalUrl: string
  /** Now, to decide whether the expiry is close; a preview pins it. */
  now?: number
}

export function MailHeader({ view, forwarded, originalUrl, now }: MailHeaderProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const [downloading, setDownloading] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const subject = displaySubject(view.subject) ?? t('row.noSubject')
  const recipients = view.participants.filter((participant) => participant.role !== 'from')
  const expiry = formatCalendarDate(view.expiresAt, locale)
  const expirySoon = expiryShownInline(view, now ?? Date.now())

  const download = async (): Promise<void> => {
    setDownloading(true)
    try {
      const result = await downloadFetched(originalUrl, 'original.eml')
      if (!result.saved) {
        toast.error(result.reason === 'original_not_clean' ? t('refusals.original_not_clean') : t(`refusals.${result.reason === 'gone' ? 'gone' : 'unknown'}`))
      }
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Collapsible
      open={detailsOpen}
      onOpenChange={(open) => {
        setDetailsOpen(open)
        // Whether the evidence behind „Details“ is still wanted, now that the header no longer shows it.
        if (open) capturePosthog('inbound_mail_details_opened', { status: view.status, risk_level: view.riskLevel })
      }}
      asChild
    >
      <header className="flex flex-col gap-2" data-testid="mail-header">
        {/* 16px on a phone, under the page's own title, which it must not outrank; 18px on a desk. */}
        <h2 className="text-base font-medium [overflow-wrap:anywhere] sm:text-lg" title={view.subject ?? undefined}>
          {subject}
        </h2>
        {/* Who on the first line; how far the domain is confirmed, when it arrived and the way to the rest on the second,
            all muted. One line of six facts was the densest on the page, and a date at the far edge was 600px from its
            name (on a phone a line of its own). Both wrap on a phone, never truncate. */}
        <div className="flex flex-col gap-1" data-testid="mail-header-line">
          {view.sender && (
            // The name in ink, the address beside it muted, no ‹ › around it: the tone tells them apart.
            <span className="text-foreground min-w-0 text-sm [overflow-wrap:anywhere]" data-testid="mail-header-from">
              {senderDisplayName(view.sender)} <span className="text-muted-foreground">{view.sender.address}</span>
            </span>
          )}
          {/* Its clauses apart by the one separator: a dot 4px from each neighbour, as every meta line of the surface. */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
            {/* Trust is never folded away. */}
            {view.sender && <SenderTrustLine sender={view.sender} impersonation={view.impersonation} claim={mailClaimOf(view)} />}
            {view.sender && <MetaDot />}
            {/* The time and „Details“ keep together, so on a phone „Details“ never stands on a line of its own. */}
            <span className="inline-flex items-center gap-x-1 whitespace-nowrap">
              <time className="text-muted-foreground tabular-nums" dateTime={view.receivedAt} data-testid="mail-header-received">
                {formatAbsoluteTime(view.receivedAt, locale)}
              </time>
              <MetaDot />
              <CollapsibleTrigger
                className="text-muted-foreground hover:text-foreground group/details touch-target inline-flex items-center gap-0.5 rounded-inline outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                data-testid="mail-details-toggle"
              >
                {t('header.details')}
                <ChevronDown className="size-3.5 transition-transform duration-quick group-data-[state=open]/details:rotate-180 motion-reduce:transition-none" aria-hidden />
              </CollapsibleTrigger>
            </span>
          </div>
        </div>
        {view.sender && <SenderFlagLines sender={view.sender} />}
        <SenderWaitLine view={view} />
        {forwarded && (
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs" data-testid="mail-forwarded">
            <Forward className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {/* The Verlauf's words for the same forward: its author first, never confirmed, the sender as the forwarder. */}
              {t('header.forwardedFrom', {
                who: forwarded.name && forwarded.address ? `${forwarded.name} ‹${forwarded.address}›` : (forwarded.name ?? forwarded.address ?? ''),
                forwarder: view.sender ? senderDisplayName(view.sender) : '',
              })}
            </span>
            <Toggletip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('header.forwardedExplain')}
                  className="hover:text-foreground touch-target inline-flex size-4 shrink-0 items-center justify-center rounded-inline outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">{t('header.forwardedExplain')}</TooltipContent>
            </Toggletip>
          </p>
        )}
        {expirySoon && (
          <FactLine icon={Timer} tone="warning" testId="mail-expires-soon">
            {t('header.expiresSoon', { date: expiry })}
          </FactLine>
        )}
        <CollapsibleContent data-testid="mail-details">
          <QuietPanel className="mt-1 gap-3 text-xs">
            <dl className="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              {view.sentAt && (
                <>
                  <dt>{t('header.sentLabel')}</dt>
                  <dd className="tabular-nums">{formatAbsoluteTime(view.sentAt, locale)}</dd>
                </>
              )}
              <dt>{t('header.receivedLabel')}</dt>
              <dd className="tabular-nums">{formatAbsoluteTime(view.receivedAt, locale)}</dd>
              {recipients.map((participant, index) => (
                <div key={`${participant.role}-${participant.address}-${index}`} className="contents">
                  <dt>{t(`header.${participant.role === 'reply_to' ? 'replyTo' : participant.role}`)}</dt>
                  <dd className="[overflow-wrap:anywhere]">{participant.name ? `${participant.name} ‹${participant.address}›` : participant.address}</dd>
                </div>
              ))}
              {view.status === 'waiting' && (
                <>
                  <dt>{t('header.waitsLabel')}</dt>
                  <dd className="tabular-nums" data-testid="mail-expires">
                    {t('header.waitsUntil', { date: expiry })}
                  </dd>
                </>
              )}
            </dl>
            {view.originalHeld && view.rawScan === 'clean' && (
              <div className="flex flex-col items-start gap-1">
                <BusyButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  busy={downloading}
                  busyLabel={t('header.original')}
                  icon={<Download aria-hidden />}
                  onClick={() => void download()}
                  data-testid="mail-original"
                >
                  {t('header.original')}
                </BusyButton>
                <p className="text-muted-foreground">{t('header.originalHint')}</p>
              </div>
            )}
            {view.originalHeld && view.rawScan === 'infected' && (
              <FactLine icon={ShieldAlert} tone="danger" testId="mail-original-infected">
                {t('header.originalNotClean')}
              </FactLine>
            )}
            {view.originalHeld && (view.rawScan === 'pending' || view.rawScan === 'failed') && (
              <FactLine icon={Timer}>{t('header.originalScanning')}</FactLine>
            )}
          </QuietPanel>
        </CollapsibleContent>
      </header>
    </Collapsible>
  )
}

function MetaDot(): JSX.Element {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  )
}
