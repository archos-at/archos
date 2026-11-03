'use client'

/**
 * „Diesem E-Mail-Verlauf folgen“, offered once a mail's text is filed into a
 * thread and only where a later reply could ever qualify (`followOffered`).
 *
 * It is a standing decision, so it says in one line what it will do and what
 * it will not: replies from confirmed domains already in the conversation are
 * added without a click; attachments still wait here. Pressing it is the
 * decision; the toast it leaves carries the undo.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { FollowCard, FollowCardHint } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface FollowOfferProps {
  threadName: string
  /** Follow the thread; rejects when the server refused. */
  onFollow: () => Promise<void>
  /** Already following (after the press, or as the server says). */
  following?: boolean
  className?: string
}

export function FollowOffer({ threadName, onFollow, following = false, className }: FollowOfferProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(following)

  const follow = async (): Promise<void> => {
    setBusy(true)
    try {
      await onFollow()
      setDone(true)
    } catch {
      // The caller says what failed; the offer stands.
    } finally {
      setBusy(false)
    }
  }

  return (
    <FollowCard
      className={className}
      data-testid="follow-offer"
      titleRole={done ? 'status' : undefined}
      title={done ? t('follow.following', { name: threadName }) : t('follow.thread', { name: threadName })}
      hint={<FollowCardHint>{t('follow.explain')}</FollowCardHint>}
      actions={
        done ? (
          <Check className="text-muted-foreground size-4 shrink-0" aria-hidden data-testid="follow-offer-done" />
        ) : (
        <BusyButton
          type="button"
          size="sm"
          variant="outline"
          busy={busy}
          busyLabel={t('follow.busy')}
          onClick={() => void follow()}
          className="w-full @md:w-auto"
          data-testid="follow-offer-button"
        >
          {t('follow.offer')}
        </BusyButton>
        )
      }
    />
  )
}
