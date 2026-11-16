'use client'

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

export const NOTICE_SETTLE_MS = 1200

export interface WhatsNewNoticeProps {
  state: WhatsNewNoticeState | null
  deferred?: boolean
  silent?: boolean
  href?: string
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

  const stop = (): void => {
    capturePosthog('whats_new_opted_out', { week: state.summary.id, surface: 'notice' })
    setDone(true)
    void postReleaseSummarySeen(state.summary.id, true)
  }

  return (
    <NoticeCard
      open={open}
      title={t('notice.title')}
      eyebrow={weekTitle({ ...state.summary, kind: 'week', version: null, summary: null, notes: [] }, locale, '')}
      closeLabel={t('notice.close')}
      closeButton={false}
      onClose={close}
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground mr-auto" onClick={stop}>
            {t('notice.stop')}
          </Button>
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
