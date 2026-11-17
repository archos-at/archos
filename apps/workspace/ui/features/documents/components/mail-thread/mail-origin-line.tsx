'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Mail, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale, useTranslations } from '@/i18n'
import { formatCalendarDate } from '@/lib/format'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'
import { cn } from '@/lib/utils'
import { documentFilesHref } from '../../lib/document-question'
import type { MailThreadClient } from './client'
import { MAIL_ENTRY_PARAM, filedSenderTrust } from './mail-thread-model'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

export function mailEntryHref(projectId: string, threadDocumentId: string, entryId: string): string {
  return `${documentFilesHref(projectId, threadDocumentId)}&${MAIL_ENTRY_PARAM}=${encodeURIComponent(entryId)}`
}

export function useOpenMailOrigin(projectId: string, client: Pick<MailThreadClient, 'get'>): (origin: MailOriginView) => Promise<void> {
  const router = useRouter()
  const t = useTranslations(mailThreadCopy)
  return async (origin) => {
    try {
      const thread = await client.get(projectId, origin.threadId)
      router.push(mailEntryHref(projectId, thread.documentId, origin.entryId))
    } catch {
      toast.error(t('provenance.openFailed'))
    }
  }
}

export interface MailOriginLineProps {
  origins: readonly MailOriginView[]
  onOpen?: (origin: MailOriginView) => Promise<void>
  variant?: 'row' | 'timeline'
  className?: string
}

export function MailOriginLine({ origins, onOpen, variant = 'timeline', className }: MailOriginLineProps): JSX.Element | null {
  const t = useTranslations(mailThreadCopy)
  const { locale } = useLocale()
  const [opening, setOpening] = useState(false)
  const origin = origins[0]
  if (!origin) return null
  const date = formatCalendarDate(origin.receivedAt, locale)
  const name = origin.fromName?.trim()
  const forwarder = origin.forwardedByName?.trim()
  const trust = origin.forwarded ? 'unverified' : filedSenderTrust(origin.senderTrust)
  const TrustIcon = trust === 'verified' ? ShieldCheck : trust === 'unverified' ? ShieldAlert : ShieldQuestion
  const trustWords =
    trust === 'verified'
      ? origin.signerDomain
        ? t('entry.trust.verified', { domain: origin.signerDomain })
        : t('entry.trust.verifiedNoDomain')
      : trust === 'unverified'
        ? t('entry.trust.unverified')
        : t('entry.trust.notChecked')

  const open = async (): Promise<void> => {
    if (!onOpen) return
    setOpening(true)
    try {
      await onOpen(origin)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-snug',
        variant === 'row' ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
      data-testid="mail-origin"
      data-trust={trust}
    >
      <span className="inline-flex min-w-0 items-start gap-1.5">
        <Mail className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {origin.forwarded && name && forwarder
            ? t('provenance.cameWithForwarded', { name, forwarder, date })
            : origin.forwarded
              ? t('provenance.cameWithForwardedAnonymous', { date })
              : name
                ? t('provenance.cameWith', { name, date })
                : t('provenance.cameWithAnonymous', { date })}
          {origins.length > 1 && <span className="text-muted-foreground"> {t('provenance.more', { count: origins.length - 1 })}</span>}
        </span>
      </span>
      <span
        className={cn('inline-flex min-w-0 items-start gap-1.5', trust === 'unverified' && 'text-foreground font-medium')}
        data-testid="mail-origin-trust"
      >
        <TrustIcon className={cn('mt-px size-3.5 shrink-0', trust === 'unverified' && 'text-warning')} aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">{trustWords}</span>
      </span>
      {onOpen && (
        <Button
          type="button"
          variant="inline"
          onClick={() => void open()}
          disabled={opening}
          aria-label={t('provenance.openLabel', { date })}
          className="touch-target"
          data-testid="mail-origin-open"
        >
          {t('provenance.open')}
        </Button>
      )}
    </div>
  )
}
