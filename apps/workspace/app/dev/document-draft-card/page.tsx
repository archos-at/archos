'use client'

import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { useChatStore } from '@/features/chat/store'
import { DocumentDraftCard } from '@/features/cards/components/DocumentDraftCard'
import { PRODUCT_NAME } from '@/lib/brand'

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex w-[680px] max-w-full flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{note}</p>
      {children}
    </section>
  )
}

export default function DocumentDraftCardPreview() {
  if (process.env.NODE_ENV !== 'development') notFound()
  useChatStore.setState({ projectId: 'proj-demo' })

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div
        data-testid="document-draft-card-preview"
        className="flex min-h-screen flex-col items-center gap-10 bg-background p-10"
      >
        <Panel
          title="Überarbeiteter Entwurf, noch nicht abgelegt"
          note={"Dreimal geschrieben: einmal angelegt, zweimal auf Zuruf geändert. Titel ist die erste Überschrift im Dokument, darunter der Pfad im Arbeitsordner — bewusst als Pfad und nicht als Dateiname, denn der Entwurf liegt nicht in den Projektdateien. „Ins Projekt übernehmen“ schreibt die Bitte in die Eingabezeile; abgelegt wird von " + PRODUCT_NAME + "."}
        >
          <DocumentDraftCard
            title="Aktenvermerk – Abweichung Fluchtweglänge"
            path="/entwuerfe/aktenvermerk-fluchtweg.md"
            bytes={4820}
            version={3}
            cardKey="document_draft-0"
          />
        </Panel>

        <Panel
          title="Im Projekt abgelegt, noch nicht eingereicht"
          note="Nach `file_draft`: Das Dokument liegt als Entwurf im Projekt. Zwei Aktionen sind jetzt echt — öffnen (neben der Unterhaltung, nicht statt ihr) und zur Freigabe einreichen. Die Zeile sagt „Entwurf“, nie „freigegeben“."
        >
          <DocumentDraftCard
            title="Aktenvermerk – Abweichung Fluchtweglänge"
            path="/entwuerfe/aktenvermerk-fluchtweg.md"
            bytes={4820}
            version={3}
            documentId="00000000-0000-4000-8000-000000000001"
            versionId="00000000-0000-4000-8000-0000000000a1"
            versionState="draft"
            cardKey="document_draft-1"
          />
        </Panel>

        <Panel
          title="Zur Freigabe eingereicht"
          note="Nach `file_draft` mit `submit` oder nach dem Klick oben: Die Fassung kann nicht mehr ersetzt werden, also gibt es hier keine Schaltfläche mehr — nur die Auskunft, worauf gewartet wird. Ein Knopf, den die Route ablehnen würde, wäre schlechter als keiner."
        >
          <DocumentDraftCard
            title="Aktenvermerk – Abweichung Fluchtweglänge"
            path="/entwuerfe/aktenvermerk-fluchtweg.md"
            bytes={4820}
            version={3}
            documentId="00000000-0000-4000-8000-000000000001"
            versionId="00000000-0000-4000-8000-0000000000a1"
            versionState="in_review"
            cardKey="document_draft-2"
          />
        </Panel>

        <Panel
          title="Erster Schreibvorgang, noch leer"
          note="Der Stummel, den das Werkzeug anlegt, bevor Inhalt darin steht: v1 und 0 B. Die Karte muss auch so vollständig aussehen — eine Karte, die erst bei reichen Werten stimmt, sieht am Tag des Platzhalters kaputt aus."
        >
          <DocumentDraftCard
            title="Baubeschreibung.md"
            path="/entwuerfe/Baubeschreibung.md"
            bytes={0}
            version={1}
            cardKey="document_draft-3"
          />
        </Panel>
      </div>
    </I18nProvider>
  )
}
