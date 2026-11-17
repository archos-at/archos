'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import {
  cancelMailImport,
  fetchMailImports,
  MailImportRequestError,
  resumeMailImport,
  startMailImport,
} from '@/lib/mail-import/client'
import type { MailImportList, MailImportView } from '@/lib/mail-import/types'
import {
  abortMailImportSend,
  clearMailImportSendFailure,
  failMailImportSend,
  isMailImportSending,
  MailImportSendBusyError,
  mailImportSendServerSnapshot,
  mailImportSendSnapshot,
  runMailImportSend,
  subscribeMailImportSend,
  type MailImportSend,
  type MailImportSendFailure,
} from '../lib/mail-import-send'

import { useShelfLive } from '@/features/realtime/use-shelf-live'

export type { MailImportSend } from '../lib/mail-import-send'

export const MAIL_IMPORT_FALLBACK_POLL_MS = 60_000

export type MailImportSendErrorKind =
  | 'busy'
  | 'alreadyRunning'
  | 'cancelled'
  | 'quota'
  | 'forbidden'
  | 'rejected'
  | 'connection'
  | 'unknown'

export interface UseMailImports {
  list: MailImportList | null
  loadError: boolean
  sending: MailImportSend | null
  sendError: MailImportSendErrorKind | null
  cancelError: boolean
  start: (file: File) => Promise<void>
  resume: (row: MailImportView, file: File) => Promise<void>
  cancel: (row: MailImportView) => Promise<boolean>
  dismissErrors: () => void
}

export function sendErrorKind(failure: Pick<MailImportSendFailure, 'stage' | 'error'>): MailImportSendErrorKind {
  const { error } = failure
  if (error instanceof MailImportSendBusyError) return 'busy'
  if (!(error instanceof MailImportRequestError)) return 'connection'
  if (error.code === 'PART_FAILED' || error.status === 0) return 'connection'
  if (error.status === 409) return failure.stage === 'start' ? 'alreadyRunning' : 'cancelled'
  if (error.status === 507) return 'quota'
  if (error.status === 401 || error.status === 403) return 'forbidden'
  if (error.status === 400 || error.status === 413 || error.status === 422) return 'rejected'
  if (error.status === 429 || error.status >= 500) return 'connection'
  return 'unknown'
}

export function useMailImports(projectId: string, open: boolean): UseMailImports {
  const [list, setList] = useState<MailImportList | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const shared = useSyncExternalStore(subscribeMailImportSend, mailImportSendSnapshot, mailImportSendServerSnapshot)
  const sending = shared.send?.projectId === projectId ? shared.send : null
  const failure = shared.failure?.projectId === projectId ? shared.failure : null

  const latest = useRef(0)
  const reload = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const next = await fetchMailImports(projectId)
      if (ticket !== latest.current) return
      setList(next)
      setLoadError(false)
    } catch {
      if (ticket === latest.current) setLoadError(true)
    }
  }, [projectId])

  const running = list?.imports.some((row) => row.status === 'queued' || row.status === 'importing') ?? false
  const isSending = sending !== null
  useEffect(() => {
    if (!open) return
    void reload()
    if (!running && !isSending) return
    const timer = setInterval(() => void reload(), MAIL_IMPORT_FALLBACK_POLL_MS)
    return () => clearInterval(timer)
  }, [open, running, isSending, reload])
  const shelf = useMemo<LiveShelf>(() => ({ kind: 'project', projectId }), [projectId])
  useShelfLive(shelf, () => void reload(), { enabled: open && running })

  const start = useCallback(
    async (file: File) => {
      clearMailImportSendFailure()
      if (isMailImportSending()) return failMailImportSend(projectId, new MailImportSendBusyError())
      let plan
      try {
        plan = await startMailImport(projectId, file)
      } catch (error) {
        failMailImportSend(projectId, error)
        return
      }
      await runMailImportSend(projectId, plan, file)
    },
    [projectId],
  )

  const resume = useCallback(
    async (row: MailImportView, file: File) => {
      clearMailImportSendFailure()
      if (isMailImportSending()) return failMailImportSend(projectId, new MailImportSendBusyError())
      let plan
      try {
        plan = await resumeMailImport(projectId, row.id)
      } catch (error) {
        failMailImportSend(projectId, error)
        return
      }
      await runMailImportSend(projectId, plan, file)
    },
    [projectId],
  )

  const cancel = useCallback(
    async (row: MailImportView) => {
      setCancelError(false)
      abortMailImportSend(row.id)
      try {
        await cancelMailImport(projectId, row.id)
        return true
      } catch {
        setCancelError(true)
        return false
      } finally {
        await reload()
      }
    },
    [projectId, reload],
  )

  const dismissErrors = useCallback(() => {
    clearMailImportSendFailure()
    setCancelError(false)
  }, [])

  return {
    list,
    loadError: loadError && list === null,
    sending,
    sendError: failure ? sendErrorKind(failure) : null,
    cancelError,
    start,
    resume,
    cancel,
    dismissErrors,
  }
}
