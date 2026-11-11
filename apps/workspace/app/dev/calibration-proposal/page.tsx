'use client'

/**
 * Dev preview: the receipt of a proposed calibration (`drawing-calibration-set`,
 * ADR-0183), as the reader of a chat sees it. Accepting it confirms "the
 * distance between these two points on this drawing is N metres", so the open
 * card shows the page clip with the reference span on it and says the length
 * in one line, above the inputs every operation receipt shows.
 *
 *   1. Open, for a reader who may decide.
 *   2. Open, for a reader who may only read: no buttons, and the line saying why.
 *   3. Applied by a colleague: „Übernommen von Anna Berger · …“.
 *   4. Open, on a document this reader may not open: the tile instead of the
 *      page, and the line no longer speaks of marked points.
 *
 * Backend-free. The proposals API is faked (`../_fixtures/fake-proposals.ts`),
 * so „Übernehmen“ and „Verwerfen“ move a proposal as the server would. A
 * module-scope fetch shim answers the drawing's `/file` with the A1 fixture
 * (`../_fixtures/a1-sheet.ts`), so the clip is the real thumbnail drawing a
 * real PDF with pdf.js, and the hidden document's with 404, as the file route
 * answers a reader who may not open it. Fixtures:
 * `../_fixtures/calibration-proposal.ts`. Gated by `../layout.tsx`. Pinned to German.
 */

import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { OperationReceipt } from '@/features/cards/components/ProposalReceipts'
import { a1SheetPdf } from '../_fixtures/a1-sheet'
import {
  CALIBRATION_DEMO,
  CALIBRATION_HIDDEN_ID,
  CALIBRATION_PROPOSALS,
  CALIBRATION_SHEET_ID,
  CALIBRATION_TITLE,
} from '../_fixtures/calibration-proposal'
import { useFakeProposalClient } from '../_fixtures/fake-proposals'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __calibrationPreviewShim?: boolean }
  if (!w.__calibrationPreviewShim) {
    w.__calibrationPreviewShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith(`/api/documents/${CALIBRATION_SHEET_ID}/file`)) {
        return new Response(a1SheetPdf('C'), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (url.includes(`/api/documents/${CALIBRATION_HIDDEN_ID}/`)) {
        return Response.json({ code: 'NOT_FOUND' }, { status: 404 })
      }
      return real(input, init)
    }
  }
}

function Scenario({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section data-testid={`calibration-scenario-${id}`} className="flex w-[680px] max-w-full flex-col gap-2">
      <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground text-xs">{note}</p>
      {children}
    </section>
  )
}

const Receipt = ({ proposalId }: { proposalId: string }) => (
  <OperationReceipt proposalId={proposalId} title={CALIBRATION_TITLE} operation="drawing-calibration-set" input={{}} />
)

export default function CalibrationProposalPreviewPage() {
  const ready = useFakeProposalClient(CALIBRATION_PROPOSALS)
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main data-testid="calibration-proposal-preview" className="bg-background flex min-h-screen flex-col items-center gap-10 p-4 sm:p-10">
        {ready && (
          <>
            <Scenario
              id="open"
              title="Offen, darf entscheiden"
              note="Der Ausschnitt der Zeichnung mit der Referenzstrecke, die Zeile, die sagt, was bestätigt wird, und darunter jede Eingabe. „Übernehmen“ wartet, bis die gekürzten Werte ganz angezeigt wurden."
            >
              <Receipt proposalId={CALIBRATION_DEMO.open} />
            </Scenario>
            <Scenario
              id="read-only"
              title="Offen, darf nicht entscheiden"
              note="Dieselbe Karte ohne Schaltflächen, mit dem Grund."
            >
              <Receipt proposalId={CALIBRATION_DEMO.readOnly} />
            </Scenario>
            <Scenario id="applied" title="Von einer Kollegin übernommen" note="Die Quittung: was geschah, wer es entschieden hat und wann.">
              <Receipt proposalId={CALIBRATION_DEMO.applied} />
            </Scenario>
            <Scenario
              id="hidden-document"
              title="Offen, Dokument für die lesende Person nicht zu öffnen"
              note="Die Kachel statt der Seite; die Zeile spricht nicht von markierten Punkten. Die Eingaben bleiben."
            >
              <Receipt proposalId={CALIBRATION_DEMO.hiddenDocument} />
            </Scenario>
          </>
        )}
      </main>
    </I18nProvider>
  )
}
