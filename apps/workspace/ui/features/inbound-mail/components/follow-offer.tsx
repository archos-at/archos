'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { FollowCard, FollowCardHint } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface FollowOfferProps {
  threadName: string
  onFollow: () => Promise<void>
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
          variant="secondary"
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
