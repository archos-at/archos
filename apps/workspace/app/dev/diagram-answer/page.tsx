'use client'

import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import { DiagramFilingProvider } from '@/features/diagrams/diagram-filing-context'
import { PRODUCT_NAME } from '@/lib/brand'

const FLOW = `\`\`\`mermaid
graph TD
  A["Einreichung"] --> B["Bauverhandlung"]
  B --> C{"Auflagen?"}
  C -- "ja" --> D["Auflagen erfüllen"]
  C -- "nein" --> E["Baubewilligung"]
  D --> E
  E --> F["Fertigstellungsanzeige"]
\`\`\``

const BROKEN = `\`\`\`mermaid
graph TD
  A[Einreichung --> B[
\`\`\``

const STREAMING = `\`\`\`mermaid
graph TD
  A["Einreichung"] --> B["Bauver`

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex w-[680px] max-w-full flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{note}</p>
      <div className="rounded-lg border border-input bg-card px-[22px] pb-[17px] pt-[18px]">{children}</div>
    </section>
  )
}

export default function DiagramAnswerPreview() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div
        data-testid="diagram-answer-preview"
        className="flex min-h-screen flex-col items-center gap-10 bg-background p-10"
      >
        <Panel
          title="Gezeichnet, im Projekt ablegbar"
          note={"Der Ablauf, von " + PRODUCT_NAME + " selbst gezeichnet, darunter die Aktion, die daraus zwei Dateien im Projekt macht: ein SVG, das in „Dateien“ vorschaubar ist und den Quelltext mitträgt, und ein PDF, das an eine Einreichung geht. Erst die abgelegte Fassung trägt die Zeile „Schematisch — ohne Maßangabe.“"}
        >
          <DiagramFilingProvider target={{ projectId: 'proj-preview', answerId: 'msg-preview' }}>
            <MarkdownRenderer content={FLOW} />
          </DiagramFilingProvider>
        </Panel>

        <Panel
          title="Nicht zeichenbar"
          note="Das Modell schreibt regelmäßig fehlerhaftes Mermaid. Die Leserin bekommt genau das, was sie vorher bekommen hätte — den Quelltext — und eine leise Zeile dazu. Kein roter Kasten."
        >
          <MarkdownRenderer content={BROKEN} />
        </Panel>

        <Panel
          title="Noch im Fluss"
          note="Während die Antwort streamt, hält ein offener Mermaid-Block den Platz der Zeichnung frei, statt seinen Quelltext zu zeigen. Ein halbes Diagramm sähe fertig aus und würde bei jedem Token einen Parse-Fehler zeigen; gezeichnet wird erst, wenn der Block geschlossen ist."
        >
          <MarkdownRenderer content={STREAMING} isStreaming />
        </Panel>
      </div>
    </I18nProvider>
  )
}
