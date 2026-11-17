'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { TaskCreatedCard } from '@/features/cards/components/TaskCreatedCard'
import { PRODUCT_NAME } from '@/lib/brand'

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
    <section className="flex w-[680px] max-w-full flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{note}</p>
      {children}
    </section>
  )
}

export default function TaskCreatedCardPreview(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div
        data-testid="task-created-card-preview"
        className="flex min-h-screen flex-col items-center gap-10 bg-background p-10"
      >
        <Panel
          title="Auftrag mit Frist und laufendem Gespräch"
          note="Die Form, in der eine Aufgabe meistens ankommt. „läuft“ ist der wichtigste Text auf der Karte — die Antwort daneben darf nicht so klingen, als sei die Arbeit getan. „Chat öffnen“ ist ein echter Link auf den Chat, den die Aufgabe schreibt."
        >
          <TaskCreatedCard
            taskId="00000000-0000-4000-8000-0000000000f1"
            kind="submission_check"
            title="Einreichcheck: Bauansuchen Haus A"
            goal="Mach den Einreichcheck für das Bauansuchen bis Freitag"
            dueAt="2026-09-18T23:59:59.999Z"
            conversationId="s_00000000_0000_4000_8000_0000000000f2"
          />
        </Panel>

        <Panel
          title="Ohne Frist, ohne Gespräch"
          note="Niemand hat eine Frist genannt, und das Gespräch für den Lauf konnte nicht angelegt werden. Die Karte behauptet dann nichts davon: zwei Wörter in der Meta-Zeile, kein Link. Sie muss trotzdem wie eine fertige Karte aussehen und nicht wie eine, die nicht zu Ende geladen hat."
        >
          <TaskCreatedCard
            taskId="00000000-0000-4000-8000-0000000000f3"
            kind="compliance_check"
            title="Normprüfung: Fluchtwege Bauteil B"
            goal="Prüf die Fluchtwege in Bauteil B gegen OIB 2"
            dueAt={null}
            conversationId={null}
          />
        </Panel>

        <Panel
          title="Titel und Auftrag, die über die Karte hinausgehen"
          note="Der Titel ist der Name, den der Auftrag in der Liste trägt; darunter steht der Satz der Person. Der Titel kürzt auf zwei Zeilen und öffnet auf Tipp („Mehr anzeigen“), der Satz bricht um — und die Meta-Zeile darunter bleibt in Form."
        >
          <TaskCreatedCard
            taskId="00000000-0000-4000-8000-0000000000f4"
            kind="document"
            title="Aktenvermerk zur Abweichung der Fluchtweglänge im 2. Obergeschoss, Bauteil B, Haus A"
            goal="Schreib mir einen Aktenvermerk zur Abweichung der Fluchtweglänge im 2. Obergeschoss von Bauteil B und nimm die Tabelle aus dem Brandschutzkonzept mit"
            dueAt="2026-09-30T23:59:59.999Z"
            conversationId="s_00000000_0000_4000_8000_0000000000f5"
          />
        </Panel>

        <Panel
          title="Überarbeitung"
          note={"Die eine Art, die nicht aus einem Satz im Chat entsteht, sondern aus einer Freigabe: „" + PRODUCT_NAME + " überarbeiten lassen“ in der Dateiablage legt sie an. Der Auftrag benennt die Fassung, um die es geht."}
        >
          <TaskCreatedCard
            taskId="00000000-0000-4000-8000-0000000000f6"
            kind="revision"
            title="Überarbeitung: Brandschutzkonzept Haus A, Fassung 2"
            goal="Die Fluchtweglänge im 2. Obergeschoss fehlt, und Tabelle 3 nennt noch die alte Gebäudeklasse."
            dueAt="2026-09-15T23:59:59.999Z"
            conversationId="s_00000000_0000_4000_8000_0000000000f7"
          />
        </Panel>
      </div>
    </I18nProvider>
  )
}
