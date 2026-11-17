'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  createDeepResearchClient,
  type DeepResearchClient,
} from '@/adapters/api/deep-research-client'
import type { ChatMessage } from '@/features/chat/types'
import { useChatStore } from '@/features/chat/store'
import { sanitizeRunLedger } from '@/lib/runs/run-ledger'
import { isTerminalRunStatus, type RunLedger } from '@/lib/runs/run-ledger-types'
import { addRunDocument, cancelRun, fetchLiveRunView, fetchRunView, RunViewError, writeNowRun } from '@/lib/runs/run-view-client'
import type { PlanDocument } from '@/lib/runs/plan-documents'
import { runDisplayStatus } from '@/lib/runs/run-vocabulary'

export interface UseRunLedgerInput {
  message: Pick<ChatMessage, 'id' | 'runLedger'>
  projectId?: string | null
  conversationId?: string | null
}

export type RunConnection = 'live' | 'reconnecting' | 'lost'

export interface UseRunLedgerResult {
  ledger: RunLedger | null
  live: boolean
  connection: RunConnection | null
  cancel: (() => Promise<void>) | null
  writeNow: (() => Promise<void>) | null
  addDocument: ((doc: PlanDocument) => Promise<void>) | null
  addDocumentFailure: AddDocumentFailure | null
}

export interface AddDocumentFailure {
  message: string | null
}

const failureOf = (error: unknown): AddDocumentFailure => ({
  message: error instanceof RunViewError && error.code === 'CONVERSATION_CONFINED' ? error.message : null,
})

function notOlder(current: RunLedger | null, candidate: RunLedger): RunLedger {
  if (!current) return candidate
  return candidate.updatedAt > current.updatedAt ? candidate : current
}

export function useRunLedger({
  message,
  projectId,
  conversationId,
}: UseRunLedgerInput): UseRunLedgerResult {
  const stored = message.runLedger ?? null
  const [ledger, setLedger] = useState<RunLedger | null>(stored)
  const [live, setLive] = useState(false)
  const [connection, setConnection] = useState<RunConnection | null>(null)

  useEffect(() => {
    if (stored) setLedger((current) => notOlder(current, stored))
  }, [stored])

  const runId = ledger?.runId ?? null
  const terminal = ledger ? isTerminalRunStatus(runDisplayStatus(ledger)) : true

  const messageId = message.id
  useEffect(() => {
    if (!ledger || !conversationId || !messageId) return
    if (stored && runDisplayStatus(stored) === runDisplayStatus(ledger)) return
    if (stored && stored.updatedAt >= ledger.updatedAt) return
    useChatStore.getState().patchConversationMessage(conversationId, messageId, {
      runLedger: ledger,
    })
  }, [ledger, stored, conversationId, messageId])

  useEffect(() => {
    if (terminal || !runId || !projectId) return

    let cancelled = false
    let client: DeepResearchClient | null = null

    const close = (): void => {
      client?.disconnect()
      client = null
      setLive(false)
      setConnection(null)
    }

    fetchLiveRunView(projectId, runId)
      .then((view) => {
        if (cancelled) return
        const fetched = view.ledger
        if (fetched) setLedger((current) => notOlder(current, fetched))
        if (!view.backendJobId) return
        if (fetched && isTerminalRunStatus(fetched.status)) return

        client = createDeepResearchClient({
          jobId: view.backendJobId,
          projectId,
          callbacks: {
            onLedger: (payload) => {
              const next = sanitizeRunLedger(payload)
              if (!next) return
              setLedger((current) => notOlder(current, next))
              if (isTerminalRunStatus(next.status)) close()
            },
            onComplete: () => {
              setLive(false)
              setConnection(null)
            },
            onReconnecting: () => setConnection('reconnecting'),
            onError: () => {
              setLive(false)
              setConnection('lost')
            },
            onDisconnect: () => {
              setLive(false)
              setConnection('lost')
            },
          },
        })
        client.connect()
        setLive(true)
        setConnection('live')
      })
      .catch(() => {
        // Fail-open: the stored ledger stays on screen.
      })

    return () => {
      cancelled = true
      close()
    }
  }, [runId, projectId, terminal])

  const cancel = useCallback(async (): Promise<void> => {
    if (!runId || !projectId) return
    try {
      const view = await cancelRun(projectId, runId)
      if (view.ledger) setLedger((current) => notOlder(current, view.ledger as RunLedger))
    } catch {
      try {
        const view = await fetchRunView(projectId, runId)
        if (view.ledger) setLedger((current) => notOlder(current, view.ledger as RunLedger))
      } catch {
        // Fail-open: the stored ledger stays on screen.
      }
    }
  }, [runId, projectId])

  const writeNow = useCallback(async (): Promise<void> => {
    if (!runId || !projectId) return
    try {
      const view = await writeNowRun(projectId, runId)
      if (view.ledger) setLedger((current) => notOlder(current, view.ledger as RunLedger))
    } catch {
      // Fail-open, like the cancel: the run goes on and the person can try again.
    }
  }, [runId, projectId])

  const [addDocumentFailure, setAddDocumentFailure] = useState<AddDocumentFailure | null>(null)
  const addDocument = useCallback(
    async (doc: PlanDocument): Promise<void> => {
      if (!runId || !projectId) return
      setAddDocumentFailure(null)
      try {
        const view = await addRunDocument(projectId, runId, doc)
        if (view.ledger) setLedger((current) => notOlder(current, view.ledger as RunLedger))
      } catch (error) {
        setAddDocumentFailure(failureOf(error))
      }
    },
    [runId, projectId]
  )

  return {
    ledger,
    live: live && !terminal,
    connection: terminal ? null : connection,
    cancel: terminal || !runId || !projectId ? null : cancel,
    writeNow: terminal || !runId || !projectId ? null : writeNow,
    addDocument: terminal || !runId || !projectId ? null : addDocument,
    addDocumentFailure,
  }
}
