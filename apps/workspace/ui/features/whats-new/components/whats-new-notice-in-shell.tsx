'use client'

/**
 * The notice as the app frame mounts it: held back while a product tour is on screen (NextStep's
 * own state), and recorded silently on "Neuerungen" itself, where the reader is already reading
 * every change. Inside the frame's `ProductTour`, which provides NextStep's context.
 */

import type { JSX } from 'react'
import { usePathname } from 'next/navigation'
import { useNextStep } from 'nextstepjs'

import type { WhatsNewNoticeState } from '@/lib/release-notes/release-notes-wire'
import { WhatsNewNotice } from './whats-new-notice'

const PAGE = '/app/whats-new'

export function WhatsNewNoticeInShell({ state }: { state: WhatsNewNoticeState | null }): JSX.Element | null {
  const { isNextStepVisible } = useNextStep()
  const pathname = usePathname() ?? ''
  return <WhatsNewNotice state={state} deferred={isNextStepVisible} silent={pathname.startsWith(PAGE)} href={PAGE} />
}
