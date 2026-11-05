'use client'

/**
 * "Neu diese Woche": the newest weekly summary, shown once to a signed-in person (ADR-0154,
 * amendment). Only the summary, never the single notes; its link leads to the full "Neuerungen".
 *
 * The server decides whether there is one to show (`resolveWhatsNewNotice`); this decides when.
 * Closing it with × or Escape, or following its link, records the week as seen for the person on
 * every device, and it does not come back in this tab either. It waits while a product tour runs,
 * and someone new here (`quietly`) is never shown it: the week is recorded without a word.
 */

import type { JSX } from 'react'
import * as React from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { NoticeCard, type NoticeCloseReason } from '@/components/ui/notice-card'
import { useLocale, useTranslations } from '@/i18n'
import { whatsNewCopy } from '@/i18n/namespaces/whats-new'
import { capturePosthog } from '@/lib/analytics/posthog'
import { postReleaseSummarySeen } from '@/lib/release-notes/client'
import type { WhatsNewNoticeState } from '@/lib/release-notes/release-notes-wire'
import { weekTitle } from './whats-new-list'

/** A beat for the page to settle before the notice arrives, so it does not land mid-paint. */
export const NOTICE_SETTLE_MS = 1200

export interface WhatsNewNoticeProps {
  state: WhatsNewNoticeState | null
  /** Hold the notice back for now: a product tour is running, or the reader is on the page it links to. */
  deferred?: boolean
  /** Record the week without showing anything: the reader is already reading every change. */
  silent?: boolean
  /** Where its link leads. */
  href?: string
  /** How long the page settles first; tests pass 0. */
  settleMs?: number
}

export function WhatsNewNotice({
  state,
  deferred = false,
  silent = false,
  href = '/app/whats-new',
  settleMs = NOTICE_SETTLE_MS,
}: WhatsNewNoticeProps): JSX.Element | null {
  const t = useTranslations(whatsNewCopy)
  const { locale } = useLocale()
  const [settled, setSettled] = React.useState(settleMs === 0)
  const [done, setDone] = React.useState(false)
  const shownRef = React.useRef(false)
  const week = state?.summary.id ?? null

  const finish = React.useCallback(() => {
    if (!week) return
    setDone(true)
    void postReleaseSummarySeen(week)
  }, [week])

  // Recorded without a word: someone new here, or already on "Neuerungen".
  const quiet = Boolean(state && (state.quietly || silent))
  React.useEffect(() => {
    if (quiet && !done) finish()
  }, [quiet, done, finish])

  React.useEffect(() => {
    if (settled) return
    const timer = window.setTimeout(() => setSettled(true), settleMs)
    return () => window.clearTimeout(timer)
  }, [settled, settleMs])

  const open = Boolean(state) && !quiet && !done && !deferred && settled
  React.useEffect(() => {
    if (!open || shownRef.current || !week) return
    shownRef.current = true
    capturePosthog('whats_new_shown', { week })
  }, [open, week])

  if (!state || quiet || done) return null

  const close = (reason: NoticeCloseReason): void => {
    capturePosthog('whats_new_dismissed', { week: state.summary.id, via: reason })
    finish()
  }

  return (
    <NoticeCard
      open={open}
      title={t('notice.title')}
      eyebrow={weekTitle({ ...state.summary, kind: 'week', version: null, summary: null, notes: [] }, locale, '')}
      closeLabel={t('notice.close')}
      onClose={close}
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => close('close_button')}>
            {t('notice.close')}
          </Button>
          <Button asChild size="sm">
            <Link
              href={href}
              onClick={() => {
                capturePosthog('whats_new_opened', { week: state.summary.id })
                finish()
              }}
            >
              {t('notice.open')}
            </Link>
          </Button>
        </>
      }
    >
      <p>{state.summary.summary[locale === 'de' ? 'de' : 'en']}</p>
    </NoticeCard>
  )
}
