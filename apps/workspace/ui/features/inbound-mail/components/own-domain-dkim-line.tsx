'use client'

/**
 * How often the office's own mail arrives „Domain bestätigt“ (RT-X6): the
 * share of the last 30 days' member mail that the office's domain signed,
 * derived from the mail itself, never from a DNS probe. When the domain signs
 * nothing, it says so and links how to set it up, because every unsigned
 * colleague's mail will ask for a confirmation before filing.
 *
 * Nothing is shown before the office has sent any mail: there is no share of
 * nothing to report.
 */

import type { JSX } from 'react'
import { ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { INBOUND_MAIL_ADDRESS_STATS_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { cn } from '@/lib/utils'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { usePublicSiteUrl } from '@/shared/context'
import { publicSiteLink } from '@/shared/public-site'

/** At or below this share the office's domain is treated as not signing at all. */
const NOT_SIGNING = 0.05

export function OwnDomainDkimLine({ share, className }: { share: number | null; className?: string }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const helpUrl = publicSiteLink(usePublicSiteUrl(), 'projectMail', locale, 'dkim')
  if (share === null || !Number.isFinite(share)) return null
  const clamped = Math.min(1, Math.max(0, share))
  if (clamped <= NOT_SIGNING) {
    return (
      <p className={cn('text-foreground flex items-start gap-1.5 text-xs leading-snug', className)} data-testid="own-domain-dkim" data-state="missing">
        <ShieldAlert className="text-warning mt-px size-3.5 shrink-0" aria-hidden />
        {helpUrl ? (
          // The kit's inline underline, but a sentence long, so it wraps as text.
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="decoration-foreground/40 hover:decoration-foreground rounded-inline underline underline-offset-[3px] outline-none transition-colors duration-quick ease-out focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
          >
            {t('address.ownDomain.missing')}
            <ExternalLink className="ml-1 inline size-3 align-[-1px]" aria-hidden />
            <span className="sr-only">{t('address.newTab')}</span>
          </a>
        ) : (
          <span>{t('address.ownDomain.missing')}</span>
        )}
      </p>
    )
  }
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(clamped * 100)
  return (
    <div className={cn('flex flex-col gap-0.5', className)} data-testid="own-domain-dkim" data-state="share">
      <p className="text-muted-foreground flex items-start gap-1.5 text-xs leading-snug">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{t('address.ownDomain.share', { percent, days: INBOUND_MAIL_ADDRESS_STATS_DAYS })}</span>
      </p>
      {clamped < 1 && <p className="text-muted-foreground pl-5 text-xs leading-snug">{t('address.ownDomain.explain')}</p>}
    </div>
  )
}
