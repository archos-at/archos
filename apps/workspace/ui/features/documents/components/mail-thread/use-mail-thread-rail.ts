'use client'

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
  peeking: boolean
  reader: boolean
  setPeekView: (view: 'details') => void
  setDetailsOpen: (open: boolean) => void
}

export interface MailThreadRail {
  mailThread: MailThreadSummaryView | null
  railView: RailView
  setRailView: (view: RailView) => void
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
