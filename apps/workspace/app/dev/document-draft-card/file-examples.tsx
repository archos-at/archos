'use client'

import type { ReactNode } from 'react'
import { FileDraftCard } from '@/features/cards/components/FileDraftCard'
import { AREA_SCHEDULE_PDF, MEMO_PDF, SECTION_SVG } from './sample-files'

export function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex w-[680px] max-w-full flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{note}</p>
      {children}
    </section>
  )
}

const urls = (rendition: string, download = rendition) => ({ rendition, download })

const MISSING = urls('/dev/no-such-rendition.pdf', '/dev/no-such-file')

export function FileDraftExamples() {
  return (
    <>
      <Panel
        title="Excel-Datei, frisch gerechnet"
        note="Die Flächenaufstellung als echte Arbeitsmappe. Die Vorschau ist die erste Seite, wie LibreOffice sie druckt; Öffnen zeigt alle Seiten, Herunterladen gibt die Originaldatei."
      >
        <FileDraftCard
          title="Flächenaufstellung Top 4.xlsx"
          path="/drafts/Flächenaufstellung Top 4.xlsx"
          bytes={9_412}
          version={1}
          cardKey="document_draft-file-0"
          urls={urls(AREA_SCHEDULE_PDF)}
        />
      </Panel>

      <Panel
        title="Word-Datei, auf Zuruf überarbeitet"
        note="Derselbe Pfad zum zweiten Mal geschrieben: eine Karte, die v2 sagt, keine zweite Karte darunter."
      >
        <FileDraftCard
          title="Aktenvermerk Fluchtweg.docx"
          path="/drafts/Aktenvermerk Fluchtweg.docx"
          bytes={18_204}
          version={2}
          cardKey="document_draft-file-1"
          urls={urls(MEMO_PDF)}
        />
      </Panel>

      <Panel title="Bild" note="Ein Schnitt als SVG: die Datei selbst ist die Vorschau.">
        <FileDraftCard
          title="Schnitt A-A.svg"
          path="/drafts/Schnitt A-A.svg"
          bytes={1_288}
          version={1}
          cardKey="document_draft-file-2"
          urls={urls(SECTION_SVG)}
        />
      </Panel>

      <Panel
        title="PDF, im Projekt abgelegt"
        note="Nach dem Ablegen ist das Projekt die Wahrheit: Öffnen und Herunterladen des Gesprächsentwurfs treten zurück, „Im Projekt öffnen“ und „Zur Freigabe einreichen“ übernehmen."
      >
        <FileDraftCard
          title="Baubeschreibung.pdf"
          path="/drafts/Baubeschreibung.pdf"
          bytes={84_220}
          version={1}
          documentId="00000000-0000-4000-8000-000000000002"
          versionId="00000000-0000-4000-8000-0000000000a2"
          versionState="draft"
          cardKey="document_draft-file-3"
        />
      </Panel>

      <Panel
        title="CSV, nicht ablegbar"
        note="Eine CSV kann die Kennzeichnung als KI-Entwurf nicht tragen. Die Karte sagt warum und bietet den Weg, der geht."
      >
        <FileDraftCard
          title="Raumliste.csv"
          path="/drafts/Raumliste.csv"
          bytes={1_034}
          version={1}
          cardKey="document_draft-file-4"
          urls={MISSING}
        />
      </Panel>

      <Panel
        title="PowerPoint ohne Vorschau"
        note="Der Konverter antwortet nicht: die Karte bleibt vollständig, mit Format und Glyphe statt der Seite."
      >
        <FileDraftCard
          title="Bauherrenpräsentation.pptx"
          path="/drafts/Bauherrenpräsentation.pptx"
          bytes={1_204_880}
          version={1}
          cardKey="document_draft-file-5"
          urls={MISSING}
        />
      </Panel>
    </>
  )
}
