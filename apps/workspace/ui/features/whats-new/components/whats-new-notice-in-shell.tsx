'use client'

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
