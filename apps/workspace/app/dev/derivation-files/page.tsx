'use client'

import { useEffect, useState } from 'react'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import type { StepDetailValue, StoredThinkingStep } from '@/lib/conversations/message-provenance'

const at = (second: number): string => new Date(Date.UTC(2026, 10, 18, 9, 0, second)).toISOString()

const step = (
  id: string,
  second: number,
  fields: Partial<StoredThinkingStep> & { detail?: Record<string, StepDetailValue> }
): StoredThinkingStep => ({
  id,
  userMessageId: 'msg-files',
  timestamp: at(second),
  isComplete: true,
  kind: 'status',
  ...fields,
})

const prepare = step('skill:office-excel', 0, {
  kind: 'skill',
  skill: 'office-excel',
  detail: { phase: 'loaded', hidden: false, title: 'Excel-Dateien' },
})

const execute = step('tool:exec', 1, { kind: 'tool', tool: 'execute' })

const fileRun = (
  id: string,
  second: number,
  key: string,
  values: Record<string, string>,
  detail: Record<string, StepDetailValue>,
  complete = true
): StoredThinkingStep =>
  step(`status:file-run:${id}`, second, {
    slot: `file-run:${id}`,
    isComplete: complete,
    turnEvent: { key, values },
    detail,
  })

const raumbuch = { file: 'Raumbuch.xlsx', format: 'xlsx' }

const inputs = { documents: ['Raumliste EG-2OG.xlsx'], document_ids: ['00000000-0000-4000-8000-0000000000a1'] }

const liveSteps: StoredThinkingStep[] = [
  prepare,
  execute,
  fileRun('a', 2, 'status.action.fileMake', raumbuch, { writes: ['Raumbuch.xlsx'], attempt: 1, status: 'error', ...inputs }),
  fileRun('b', 4, 'status.action.fileRetry', raumbuch, { writes: ['Raumbuch.xlsx'], attempt: 2, ...inputs }, false),
]

const settledSteps: StoredThinkingStep[] = [
  prepare,
  execute,
  fileRun('a', 2, 'status.action.fileMake', raumbuch, { writes: ['Raumbuch.xlsx'], attempt: 1, status: 'error', ...inputs }),
  fileRun('b', 4, 'status.action.fileRetry', raumbuch, {
    writes: ['Raumbuch.xlsx'],
    attempt: 2,
    status: 'ok',
    made: ['Raumbuch.xlsx'],
    elapsed_ms: 1800,
    ...inputs,
  }),
  fileRun('c', 6, 'status.action.fileCheck', raumbuch, { reads: ['Raumbuch.xlsx'], status: 'ok', result: '42' }),
  fileRun('d', 8, 'status.action.calculation', {}, { status: 'ok', result: '{"Nutzfläche m²": 92.87}', ...inputs }),
  fileRun('e', 9, 'status.action.fileEdit', { file: 'Baubeschreibung.docx', format: 'docx' }, {
    writes: ['Baubeschreibung.docx'],
    editing: ['Baubeschreibung.docx'],
    status: 'ok',
    changed: ['Baubeschreibung.docx'],
    elapsed_ms: 14200,
  }),
]

const failedSteps: StoredThinkingStep[] = [
  execute,
  fileRun('a', 2, 'status.action.fileMake', { file: 'Präsentation Bauherr.pptx', format: 'pptx' }, {
    writes: ['Präsentation Bauherr.pptx'],
    status: 'error',
  }),
  fileRun('b', 4, 'status.action.fileRetry', { file: 'Präsentation Bauherr.pptx', format: 'pptx' }, {
    writes: ['Präsentation Bauherr.pptx'],
    attempt: 2,
    status: 'timeout',
  }),
]

const VARIANTS: Record<string, { title: string; steps: StoredThinkingStep[]; live: boolean }> = {
  live: { title: 'mid-run: the status line names the file, a retry continues the phase', steps: liveSteps, live: true },
  settled: { title: 'settled: one row per file or calculation', steps: settledSteps, live: false },
  failed: { title: 'settled: the last attempt failed, with a retry', steps: failedSteps, live: false },
}

export default function DerivationFilesPreviewPage() {
  const [variant, setVariant] = useState<string>('settled')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setVariant(params.get('variant') ?? 'settled')
    setOpen(params.get('open') === '1')
  }, [])
  const shown = VARIANTS[variant] ?? VARIANTS.settled

  return (
    <main className="bg-background min-h-dvh px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <h1 className="text-muted-foreground font-mono text-xs" data-testid="derivation-files-preview">
          {`/dev/derivation-files?variant=${variant}${open ? '&open=1' : ''} — ${shown.title}`}
        </h1>
        <div className="w-[680px] max-w-full">
          <ChatThinking
            key={`${variant}:${open}`}
            steps={shown.steps}
            isThinking={shown.live}
            userQuestion="Mach mir das Raumbuch als Excel"
            defaultOpen={open}
          />
        </div>
      </div>
    </main>
  )
}
