'use client'

import type { JSX } from 'react'
import { I18nProvider } from '@/i18n'
import { JobRunHistory } from '@/features/jobs/components/job-run-history'
import type { TaskRunView } from '@/lib/tasks/task-wire'

const NOW = Date.now()
const at = (offsetHours: number): string => new Date(NOW + offsetHours * 3600_000).toISOString()

const run = (overrides: Partial<TaskRunView> & Pick<TaskRunView, 'id' | 'status' | 'createdAt'>): TaskRunView => ({
  taskId: 'j1',
  kind: 'deep-research',
  title: 'Wöchentlicher OIB-Brandschutz-Scan',
  goal: null,
  review: null,
  reviewReason: null,
  filedDocumentId: null,
  conversationId: 'conv-8f21',
  runMessageId: null,
  trigger: 'schedule',
  requesterUserId: 'user_1',
  requesterName: 'Anna Berger',
  finishedAt: null,
  error: null,
  ...overrides,
})

const RUNS: TaskRunView[] = [
  run({ id: 'r1', trigger: 'manual', status: 'running', createdAt: at(-0.3), runMessageId: 'msg-r1' }),
  run({ id: 'r2', status: 'succeeded', createdAt: at(-24 * 7), runMessageId: 'msg-r2' }),
  run({ id: 'r3', status: 'succeeded', createdAt: at(-24 * 14) }),
  run({
    id: 'r4',
    status: 'failed',
    createdAt: at(-24 * 21),
    error: 'Die Recherche wurde nach 30 Minuten ohne Ergebnis beendet.',
  }),
  run({
    id: 'r5',
    status: 'skipped',
    createdAt: at(-24 * 28),
    conversationId: null,
    error: 'Die Organisation hatte bereits die maximale Anzahl aktiver Läufe.',
  }),
]

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __jobRunHistoryShim?: boolean }
  if (!w.__jobRunHistoryShim) {
    w.__jobRunHistoryShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/runs')) {
        return Response.json({ runs: RUNS, nextCursor: null })
      }
      return real(input, init)
    }
  }
}

export default function JobRunHistoryDevPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="job-run-history-preview"
        className="min-h-dvh bg-background p-8 text-foreground"
      >
        <div className="mx-auto w-full max-w-[720px] rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Ausführungsverlauf</h2>
          <div className="border-t border-border pt-1">
            <JobRunHistory projectId="p1" jobId="j1" />
          </div>
        </div>
      </main>
    </I18nProvider>
  )
}
