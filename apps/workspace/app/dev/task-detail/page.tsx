'use client'

import type { JSX } from 'react'
import { useSearchParams } from 'next/navigation'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { I18nProvider } from '@/i18n'
import { TaskDetail } from '@/features/tasks/components/task-detail'
import type { TaskRunView } from '@/features/tasks/lib/task-view'
import { RUN_DONE } from '../_fixtures/run-ledgers'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __taskDetailShim?: boolean }
  if (!w.__taskDetailShim) {
    w.__taskDetailShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/runs/task-1')) {
        return Response.json({
          runId: 'task-1',
          taskId: null,
          conversationId: 'conv-1',
          messageId: 'msg-1',
          status: 'succeeded',
          ledger: RUN_DONE,
        })
      }
      return real(input, init)
    }
  }
}

const BASE: TaskRunView = {
  id: 'task-1',
  kind: 'deep-research',
  title: 'Brandschutzkonzept — Fluchtwege Haus A',
  goal: 'Prüfe die Fluchtweglängen im Atrium gegen OIB 2 und die Wiener Abweichungen.',
  status: 'succeeded',
  review: null,
  reviewReason: null,
  filedDocumentId: 'doc-brandschutz-fluchtwege',
  conversationId: 'conv-1',
  runMessageId: 'msg-1',
  taskId: null,
  trigger: 'delegated',
  requesterUserId: 'user_anna',
  requesterName: 'Anna Berger',
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  error: null,
  runSummary: { status: 'done', rounds: 3, docs: 9 },
}

const LEGACY: TaskRunView = {
  ...BASE,
  runMessageId: null,
  runSummary: null,
  review: 'rejected',
  reviewReason:
    'Der Nachweis für die Barrierefreiheit ist übersehen worden — bitte mit OIB 4 gegenprüfen.',
}

function TaskDetailPreviewBody(): JSX.Element {
  const legacy = useSearchParams().get('state') === 'legacy'
  return (
    <div
      data-testid="task-detail-preview"
      className="bg-background text-foreground flex min-h-screen flex-col gap-2 p-10"
    >
      <h2 className="text-foreground text-sm font-semibold">
        {legacy ? 'Ein Lauf ohne Ablauf' : 'Was der Lauf getan hat'}
      </h2>
      <p className="text-muted-foreground max-w-prose text-xs">
        {legacy
          ? 'Ein Lauf aus der Zeit vor den Laufnachrichten. Es gibt keinen Block, also stehen die Angaben der Zeile da — zu beurteilen: ob das als „mehr gibt es nicht“ liest und nicht als eine Ansicht, die nicht geladen hat.'
          : 'Der Block, nicht eine zweite Beschreibung davon. Zu beurteilen: ob er in einer Schublade so gut sitzt wie im Verlauf, ob aufgeklappt hier richtig ist (der Klick auf die Zeile IST die Bitte hineinzusehen), und ob die drei Knöpfe darunter als Leiter lesen statt als drei gleichwertige Wege.'}
      </p>
      <TaskDetail
        projectId="p1"
        task={legacy ? LEGACY : BASE}
        open
        canManageJobs
        onPromoteToTask={() => {}}
        onClose={() => {}}
      />
    </div>
  )
}

export default function TaskDetailPreview(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Suspense>
        <TaskDetailPreviewBody />
      </Suspense>
    </I18nProvider>
  )
}
