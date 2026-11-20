'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import type { InboundMailClient } from '../lib/client'
import { FollowOffer } from './follow-offer'
import { mailToast } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

/** After a text was filed: the follow of the E-Mail-Verlauf it went into, once that Verlauf is known. */
export function FiledFollow({ projectId, client, documentId }: { projectId: string; client: InboundMailClient; documentId: string }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const [target, setTarget] = useState<{ threadId: string; name: string; followed: boolean } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    client
      .threadOfDocument(projectId, documentId)
      .then((thread) => {
        if (alive.current && thread) setTarget({ threadId: thread.id, name: thread.name, followed: thread.followed })
      })
      .catch(() => undefined)
    return () => void (alive.current = false)
  }, [client, projectId, documentId])

  if (!target) return null
  const followed = (value: boolean): void => {
    if (alive.current) setTarget((current) => (current ? { ...current, followed: value } : current))
  }
  return (
    <FollowOffer
      key={target.threadId}
      threadName={target.name}
      following={target.followed}
      onFollow={async () => {
        try {
          await client.follow(projectId, target.threadId)
          followed(true)
          toast.success(
            t('follow.following', { name: target.name }),
            mailToast({ action: { label: t('follow.undo'), onClick: () => void client.unfollow(projectId, target.threadId).then(() => followed(false)) } })
          )
        } catch (error) {
          toast.error(t('follow.failed'), mailToast())
          throw error
        }
      }}
      onUnfollow={async () => {
        try {
          await client.unfollow(projectId, target.threadId)
          followed(false)
        } catch (error) {
          toast.error(t('follow.failed'), mailToast())
          throw error
        }
      }}
    />
  )
}
