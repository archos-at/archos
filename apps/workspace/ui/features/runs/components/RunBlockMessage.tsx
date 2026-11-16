'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, motionEntrance, motionInstant } from '@/components/motion'
import type { ChatMessage } from '@/features/chat/types'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTranslations } from '@/i18n'
import { runsCopy } from '@/i18n/namespaces/runs'
import type { RunStatus } from '@/lib/runs/run-ledger-types'
import { runDisplayStatus } from '@/lib/runs/run-vocabulary'
import { useRunLedger } from '../hooks/use-run-ledger'
import { useProjectInventory } from '../hooks/use-project-inventory'
import { DocumentsDialog } from './DocumentsDialog'
import { openFilePeek } from '@/features/documents/lib/open-file-peek'
import type { RunLedgerDoc } from '@/lib/runs/run-ledger-types'
import { landingDelays } from '../lib/choreography'
import { RunBlock } from './RunBlock'

const REPORT_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['done', 'interrupted'])

export interface RunBlockMessageProps {
  message: ChatMessage
  projectId?: string | null
  conversationId?: string | null
  answer?: ReactNode
  onContinue?: (() => void | Promise<void>) | null
}

export function RunBlockMessage({
  message,
  projectId,
  conversationId,
  answer,
  onContinue,
}: RunBlockMessageProps): JSX.Element | null {
  const t = useTranslations(runsCopy)
  const { ledger, live, cancel, writeNow, addDocument, addDocumentFailure, connection } = useRunLedger({
    message,
    projectId,
    conversationId,
  })
  const reduced = useReducedMotion()
  const [picking, setPicking] = useState(false)
  const [wantsInventory, setWantsInventory] = useState(false)
  const inventory = useProjectInventory(projectId ?? null, wantsInventory)
  const [pendingDoc, setPendingDoc] = useState<RunLedgerDoc | null>(null)
  const openDocument = useCallback((doc: RunLedgerDoc): void => {
    setWantsInventory(true)
    setPendingDoc(doc)
  }, [])
  useEffect(() => {
    if (!pendingDoc || !inventory.documents) return
    setPendingDoc(null)
    const key = pendingDoc.name.trim().toLocaleLowerCase()
    const found = inventory.documents.find((row) => row.name.trim().toLocaleLowerCase() === key)
    if (!found) return
    openFilePeek({
      file: found.file,
      source: found.source,
      projectId: projectId ?? null,
      presentation: 'modal',
      bindComposerSubject: false,
    })
  }, [pendingDoc, inventory.documents, projectId])
  const paintedRef = useRef(false)
  useEffect(() => {
    paintedRef.current = true
  }, [])

  if (!ledger) return null

  const status = runDisplayStatus(ledger)
  const showAnswer = REPORT_STATUSES.has(status) && message.content.trim().length > 0
  const rises = paintedRef.current && !reduced

  return (
    <div className="flex flex-col gap-3" data-testid="run-block-message" data-run-id={ledger.runId}>
      <RunBlock
        ledger={ledger}
        title={message.runTitle ?? null}
        projectId={projectId ?? null}
        live={live}
        connection={connection}
        onCancel={cancel}
        onWriteNow={writeNow}
        onAddDocument={
          addDocument
            ? () => {
                setWantsInventory(true)
                setPicking(true)
              }
            : null
        }
        addDocumentFailure={
          addDocumentFailure ? (addDocumentFailure.message ?? t('documents.addFailed')) : null
        }
        onOpenDocument={projectId ? openDocument : null}
        onContinue={onContinue ?? null}
      />
      {addDocument && (
        <DocumentsDialog
          mode="add"
          open={picking}
          onOpenChange={setPicking}
          documents={inventory.documents ?? []}
          loading={inventory.loading}
          named={(ledger.basis ?? []).map((doc) => doc.name)}
          onAdd={(doc) => addDocument(doc)}
        />
      )}
      {showAnswer ? (
        <motion.div
          initial={rises ? { opacity: 0, y: 6 } : false}
          animate={{
            opacity: 1,
            y: 0,
            transition: rises
              ? { ...motionEntrance, delay: landingDelays(status).report }
              : motionInstant,
          }}
          data-testid="run-report"
        >
          {answer}
        </motion.div>
      ) : null}
    </div>
  )
}
