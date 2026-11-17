'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import { toast } from 'sonner'

import { useTranslations } from '@/i18n'
import { notificationsCopy } from '@/i18n/namespaces/notifications'
import { inboxClient, type InboxClient } from '@/lib/inbox/client'
import { useInboxBadge } from '@/features/collaboration/hooks/use-inbox'
import { canonicalInboxType } from '@/lib/inbox/types'
import { usePushNotifications } from '../hooks/use-push-notifications'
import { promptIsDue, usePromptOnScreen, usePushPromptDismissal } from './notification-prompt'

const SHOWN_KEY = 'push-offer.shown'
const TOAST_ID = 'agent-push-offer'
const OFFER_MS = 20_000

function shownThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SHOWN_KEY) === '1'
  } catch {
    return false
  }
}

function markShown(): void {
  try {
    window.sessionStorage.setItem(SHOWN_KEY, '1')
  } catch {
    // Blocked storage: the in-memory guard below still holds for this page.
  }
}

type Asker = { kind: 'piloti' } | { kind: 'person'; actor: string | null; mentioned: boolean }

async function newestAsker(client: InboxClient): Promise<Asker> {
  try {
    const page = await client.list({ filter: 'requests' })
    const newest = page.items[0]
    if (newest && canonicalInboxType(newest.type) === 'agent.asks_you') return { kind: 'piloti' }
    return { kind: 'person', actor: newest?.actorName ?? null, mentioned: newest?.type === 'mention.requested' }
  } catch {
    return { kind: 'person', actor: null, mentioned: false }
  }
}

function offerKey(asker: Asker): 'offer.piloti' | 'offer.mentioned' | 'offer.actor' | 'offer.someone' {
  if (asker.kind === 'piloti') return 'offer.piloti'
  if (!asker.actor) return 'offer.someone'
  return asker.mentioned ? 'offer.mentioned' : 'offer.actor'
}

export function InboxPushOffer({
  enabled,
  client = inboxClient,
}: {
  enabled: boolean
  client?: InboxClient
}): JSX.Element | null {
  const { pending } = useInboxBadge(enabled, client)
  const { dismissed } = usePushPromptDismissal()
  const previous = useRef(0)
  const rose = useRef(false)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (previous.current === 0 && pending > 0) rose.current = true
    if (pending === 0) rose.current = false
    previous.current = pending
    if (enabled && rose.current && !dismissed && !shownThisSession()) setArmed(true)
  }, [enabled, pending, dismissed])

  return armed ? <OfferWhenDue client={client} /> : null
}

function OfferWhenDue({ client }: { client: InboxClient }): JSX.Element | null {
  const t = useTranslations(notificationsCopy)
  const push = usePushNotifications()
  const { dismissed, dismiss } = usePushPromptDismissal()
  const promptOnScreen = usePromptOnScreen()
  const offered = useRef(false)
  const latest = useRef({ push, dismiss })
  useEffect(() => {
    latest.current = { push, dismiss }
  }, [push, dismiss])

  useEffect(() => {
    if (promptOnScreen) toast.dismiss(TOAST_ID)
  }, [promptOnScreen])

  useEffect(() => {
    if (offered.current || !promptIsDue(push, dismissed) || shownThisSession()) return
    if (promptOnScreen) {
      offered.current = true
      markShown()
      return
    }
    offered.current = true
    markShown()
    void newestAsker(client).then((asker) => {
      const message = t(offerKey(asker), asker.kind === 'person' && asker.actor ? { actor: asker.actor } : undefined)
      toast(message, {
        id: TOAST_ID,
        duration: OFFER_MS,
        action: { label: t('offer.turnOn'), onClick: () => void latest.current.push.enable() },
        cancel: { label: t('offer.notNow'), onClick: () => latest.current.dismiss() },
      })
    })
  }, [push, dismissed, promptOnScreen, client, t])

  return null
}
