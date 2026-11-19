'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { BusyButton } from '@/components/ui/busy-button'
import { FollowCard, FollowCardHint } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { MAIL_THREAD_FOLLOW_DEFAULT_DAYS } from '@/lib/mail-thread/mail-thread-wire'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface FollowOfferProps {
  threadName: string
  onFollow: () => Promise<void>
  onUnfollow?: () => Promise<void>
  following?: boolean
  className?: string
}

/** After a reply is filed, the offer to file the Verlauf's further replies without a click; once on, what runs and how to end it. */
export function FollowOffer({ threadName, onFollow, onUnfollow, following = false, className }: FollowOfferProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } catch {
      // The caller says what failed; the card stands as it was.
    } finally {
      setBusy(false)
    }
  }

  return (
    <FollowCard
      className={className}
      data-testid="follow-offer"
      data-following={following || undefined}
      titleRole="status"
      titleTestId="follow-offer-title"
      title={following ? t('follow.following', { name: threadName }) : t('follow.thread', { name: threadName })}
      hint={<FollowCardHint testId="follow-offer-hint">{t(following ? 'follow.followingExplain' : 'follow.explain', { days: MAIL_THREAD_FOLLOW_DEFAULT_DAYS })}</FollowCardHint>}
      actions={
        following ? (
          onUnfollow && (
            <BusyButton
              type="button"
              size="sm"
              variant="secondary"
              busy={busy}
              busyLabel={t('follow.unfollowBusy')}
              onClick={() => void run(onUnfollow)}
              className="w-full @md:w-auto"
              data-testid="follow-offer-unfollow"
            >
              {t('follow.unfollow')}
            </BusyButton>
          )
        ) : (
          <BusyButton
            type="button"
            size="sm"
            variant="secondary"
            busy={busy}
            busyLabel={t('follow.busy')}
            onClick={() => void run(onFollow)}
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
