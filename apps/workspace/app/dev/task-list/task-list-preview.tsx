'use client'

import { useState } from 'react'
import { I18nProvider } from '@/i18n'
import { Button } from '@/components/ui/button'
import { TaskList } from '@/features/tasks/components/task-list'
import type { TaskFilter, TaskRunView } from '@/features/tasks/lib/task-view'

const HOUR = 60 * 60 * 1000

const fixtures = (now: number) => {
  const ago = (ms: number): string => new Date(now - ms).toISOString()
  const row = (overrides: Partial<TaskRunView>): TaskRunView => ({
    id: 'task-0',
    kind: 'document',
    title: 'Aktenvermerk',
    goal: null,
    status: 'succeeded',
    review: null,
    reviewReason: null,
    filedDocumentId: null,
    conversationId: null,
    runMessageId: null,
    taskId: null,
    trigger: 'delegated',
    requesterUserId: 'user_anna',
    requesterName: 'Anna Berger',
    createdAt: ago(3 * HOUR),
    finishedAt: ago(2 * HOUR),
    error: null,
    ...overrides,
  })

  const tasks: TaskRunView[] = [
    row({
      id: 'task-1',
      kind: 'revision',
      title: 'Brandschutzkonzept — Fluchtwege, zweite Fassung',
      goal: 'Die Fluchtweglänge im Atrium stimmt nicht; OIB 2.3 gilt hier, nicht 2.',
      status: 'running',
      requesterName: 'Maria Huber',
      runSummary: { status: 'running', rounds: 3, docs: 9 },
    }),
    row({
      id: 'task-1b',
      kind: 'deep-research',
      title: 'Wöchentlicher OIB-Brandschutz-Scan',
      goal: null,
      trigger: 'schedule',
      requesterName: null,
    }),
    row({
      id: 'task-2',
      kind: 'document',
      title: 'Aktenvermerk Stellplatzverpflichtung',
      goal: 'Fasse zusammen, was für die Einreichung an Stellplätzen nachzuweisen ist',
      filedDocumentId: 'doc-9',
      review: 'accepted',
      conversationId: 'conv-2',
      runMessageId: 'msg-2',
      runSummary: { status: 'done', rounds: 4, docs: 11 },
    }),
    row({
      id: 'task-3',
      kind: 'submission_check',
      title: 'Einreichcheck vor Abgabe',
      goal: 'Was fehlt noch für die Einreichung am 30.9.?',
      review: 'rejected',
      reviewReason:
        'Der Nachweis für die Barrierefreiheit ist übersehen worden — bitte mit OIB 4 gegenprüfen.',
      conversationId: 'conv-3',
      createdAt: new Date(now - 30 * HOUR).toISOString(),
    }),
    row({
      id: 'task-4',
      kind: 'compliance_check',
      title: 'Normprüfung Bestandsplan',
      status: 'failed',
      error: 'Das Budget war aufgebraucht, bevor die Prüfung fertig war.',
      requesterName: null,
      createdAt: ago(4 * 24 * HOUR),
      finishedAt: ago(4 * 24 * HOUR - 20 * 60 * 1000),
      conversationId: 'conv-4',
      runMessageId: 'msg-4',
      runSummary: { status: 'failed', rounds: 2, docs: 5 },
    }),
  ]
  const arriving = row({
    id: 'task-new',
    kind: 'deep-research',
    title: 'Recherche Lärmschutz Innenhof',
    goal: 'Welche Grenzwerte gelten für den Innenhof zur Nachbarliegenschaft?',
    status: 'running',
    createdAt: ago(0),
    finishedAt: null,
    runSummary: { status: 'running', rounds: 1, docs: 2 },
  })
  return { tasks, arriving }
}

function FilterableList({
  tasks,
  loading,
  failed,
}: {
  tasks: TaskRunView[]
  loading?: boolean
  failed?: boolean
}) {
  const [filter, setFilter] = useState<TaskFilter>('all')
  return (
    <TaskList
      projectId="preview"
      tasks={tasks}
      loading={loading}
      failed={failed}
      filter={filter}
      onFilterChange={setFilter}
      onSelectTask={() => {}}
    />
  )
}

function GlidingList({
  now,
  initial,
  arriving,
}: {
  now: number
  initial: TaskRunView[]
  arriving: TaskRunView
}) {
  const [tasks, setTasks] = useState<TaskRunView[]>(initial)
  const arrived = tasks.some((task) => task.id === arriving.id)
  const aged = tasks.some(
    (task) => task.id === 'task-2' && task.createdAt !== initial[2]?.createdAt
  )

  const toggleArrival = () =>
    setTasks((current) =>
      arrived ? current.filter((task) => task.id !== arriving.id) : [arriving, ...current]
    )
  const toggleMidnight = () =>
    setTasks((current) =>
      current.map((task) =>
        task.id === 'task-2'
          ? {
              ...task,
              createdAt: aged
                ? (initial[2]?.createdAt ?? task.createdAt)
                : new Date(now - 30 * HOUR).toISOString(),
            }
          : task
      )
    )

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-2 border-b p-3">
        <Button size="sm" variant="secondary" onClick={toggleArrival} data-testid="glide-arrival">
          {arrived ? 'Neuen Lauf wieder entfernen' : 'Ein neuer Lauf kommt an'}
        </Button>
        <Button size="sm" variant="secondary" onClick={toggleMidnight} data-testid="glide-midnight">
          {aged ? 'Zurück auf heute' : 'Mitternacht vergeht'}
        </Button>
      </div>
      <FilterableList tasks={tasks} />
    </div>
  )
}

function Panel({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="flex w-[720px] max-w-full flex-col gap-2">
      <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground text-xs">{note}</p>
      <div className="bg-card rounded-lg border">{children}</div>
    </section>
  )
}

export function TaskListPreview({ now }: { now: number }) {
  const { tasks, arriving } = fixtures(now)

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div
        data-testid="task-list-preview"
        className="bg-background flex min-h-screen flex-col items-center gap-10 p-10"
      >
        <Panel
          title="Was gerade läuft, und was schon beurteilt ist"
          note="Fünf Karten, fünf verschiedene Antworten auf „was ist daraus geworden“. Zu beurteilen: ob das Farbquadrat vor dem Titel beim Überfliegen einer Spalte trägt, ohne lauter zu sein als der Titel selbst; ob der Punkt rechts als „noch ungeprüft“ liest; ob „Zurückgeschickt“ und die Begründung darunter zusammengehören; und ob der eine Link in der Fußzeile als Ort liest — er ist das Einzige in der Karte, das nicht die Karte selbst anklickt."
        >
          <FilterableList tasks={tasks} />
        </Panel>

        <Panel
          title="Eine Karte wechselt ihren Platz"
          note="Die zwei Knöpfe tun, was eine Abfrage täte. Zu beurteilen: ob die Karte, die sich bewegt hat, dorthin gleitet und die übrigen Platz machen, ohne zu springen; und ob ein Druck auf einen Filter weiterhin nur überblendet und nichts fliegen lässt."
        >
          <GlidingList now={now} initial={tasks} arriving={arriving} />
        </Panel>

        <Panel
          title="Noch nichts übergeben"
          note="Der Zustand am ersten Tag. Er muss als Einladung lesen, nicht als Liste, die nicht geladen hat — genau diesen Unterschied trägt der Fehlerzustand darunter."
        >
          <FilterableList tasks={[]} />
        </Panel>

        <Panel
          title="Die Liste konnte nicht geladen werden"
          note="Der Unterschied zum Zustand darüber ist die eine Lüge, auf die jemand hin handeln würde."
        >
          <FilterableList tasks={[]} failed />
        </Panel>
      </div>
    </I18nProvider>
  )
}
