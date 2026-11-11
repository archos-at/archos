'use client'

/**
 * Dev preview: a proposed calibration (`drawing-calibration-set`, ADR-0183) as
 * the reader of a chat sees it: one question answered by eye. The page clip
 * with the region and the reference span, „Ist die markierte Strecke 10,80 m
 * lang?“, the scale a yes sets, and „Bestätigen“ or „Verwerfen“. No action
 * name, no coordinates.
 *
 *   1. Open, for a reader who may decide.
 *   2. Open, for a reader who may only read: no buttons, and the line saying why.
 *   3. Confirmed by a colleague: „Maßstab bestätigt.“, who and when.
 *   4. Open, on a document this reader may not open: nothing can be checked by
 *      eye, so the generic receipt with every input stands in.
 *
 * Backend-free. The proposals API is faked (`../_fixtures/fake-proposals.ts`),
 * so „Bestätigen“ and „Verwerfen“ move a proposal as the server would. A
 * module-scope fetch shim answers the drawing's `/file` with the A1 fixture
 * (`../_fixtures/a1-sheet.ts`), so the clip is the real thumbnail drawing a
 * real PDF with pdf.js and the scale is computed from that page, and the
 * hidden document's with 404, as the file route answers a reader who may not
 * open it. Fixtures: `../_fixtures/calibration-proposal.ts`. Gated by
 * `../layout.tsx`. Pinned to German.
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
              note="Eine Frage, mit einem Blick zu beantworten: der Ausschnitt mit der markierten Strecke, die Länge, und welcher Maßstab bei „Ja“ gilt."
            >
              <Receipt proposalId={CALIBRATION_DEMO.open} />
            </Scenario>
            <Scenario id="read-only" title="Offen, darf nicht entscheiden" note="Dieselbe Frage ohne Schaltflächen, mit dem Grund.">
              <Receipt proposalId={CALIBRATION_DEMO.readOnly} />
            </Scenario>
            <Scenario id="applied" title="Von einer Kollegin bestätigt" note="Die Quittung: was gilt, wer es bestätigt hat und wann.">
              <Receipt proposalId={CALIBRATION_DEMO.applied} />
            </Scenario>
            <Scenario
              id="hidden-document"
              title="Offen, Dokument für die lesende Person nicht zu öffnen"
              note="Ohne Ausschnitt lässt sich nichts mit einem Blick prüfen: die allgemeine Karte mit jeder Eingabe, damit nichts ungesehen übernommen wird."
            >
              <Receipt proposalId={CALIBRATION_DEMO.hiddenDocument} />
            </Scenario>
          </>
        )}
      </main>
    </I18nProvider>
  )
}
