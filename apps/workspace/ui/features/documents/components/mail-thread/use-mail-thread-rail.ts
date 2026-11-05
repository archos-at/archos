'use client'

/**
 * The preview's rail for a thread document (`useFilePreviewController`): which
 * thread it is, which of its two tabs is up, and the mail a link points at.
 *
 * A thread document's rail is two tabs, „E-Mails“ and „Details“
 * (`ThreadRailViews`); the mails are up whenever a thread document arrives. A
 * link into one mail of the thread (`?mailEntry=`, from a Fassung's
 * provenance or a citation) opens the „E-Mails“ tab, scrolled to it, wherever
 * the rail is (the peek's Details face, the phone's details sheet).
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { MailThreadSummaryView } from '@/lib/mail-thread/mail-thread-wire'
import { mailThreadClient } from './client'
import { MAIL_ENTRY_PARAM } from './mail-thread-model'
import type { RailView } from './rail-views'
import { useMailThreadOfDocument } from './use-mail-thread-of-document'

export interface MailThreadRailInput {
  projectId: string | undefined
  file: { id: string; filename: string; tags?: readonly string[] | null }
  /** The preview is the peek: a mail link turns it to its Details face. */
  peeking: boolean
  /** The preview is the phone's reader: a mail link opens its details sheet. */
  reader: boolean
  setPeekView: (view: 'details') => void
  setDetailsOpen: (open: boolean) => void
}

export interface MailThreadRail {
  mailThread: MailThreadSummaryView | null
  railView: RailView
  setRailView: (view: RailView) => void
  /** The mail a `?mailEntry=` link points at, for the „E-Mails“ tab to scroll to. */
  mailFocus: { entryId: string } | undefined
}

export function useMailThreadRail({ projectId, file, peeking, reader, setPeekView, setDetailsOpen }: MailThreadRailInput): MailThreadRail {
  const mailThread = useMailThreadOfDocument(projectId, file, mailThreadClient)
  const [railView, setRailView] = useState<RailView>('mail')
  useEffect(() => {
    setRailView('mail')
  }, [file.id])
  const searchParams = useSearchParams()
  const mailEntryParam = searchParams?.get(MAIL_ENTRY_PARAM) ?? null
  const mailFocus = useMemo(() => (mailEntryParam ? { entryId: mailEntryParam } : undefined), [mailEntryParam])
  useEffect(() => {
    if (!mailThread || !mailEntryParam) return
    setRailView('mail')
    if (peeking) setPeekView('details')
    if (reader) setDetailsOpen(true)
  }, [mailThread, mailEntryParam, peeking, reader, setPeekView, setDetailsOpen])
  return { mailThread, railView, setRailView, mailFocus }
}
