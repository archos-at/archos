'use client'

import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { CalibrationReceipt } from '@/features/cards/components/CalibrationProposalPreview'
import { a1SheetPdf } from '../_fixtures/a1-sheet'
import {
  CALIBRATION_DEMO,
  CALIBRATION_HIDDEN_ID,
  CALIBRATION_INPUT,
  CALIBRATION_PROPOSALS,
  CALIBRATION_SHEET_ID,
} from '../_fixtures/calibration-proposal'
import { useFakeProposalClient } from '../_fixtures/fake-proposals'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __calibrationPreviewShim?: boolean }
  if (!w.__calibrationPreviewShim) {
    w.__calibrationPreviewShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith(`/api/documents/${CALIBRATION_SHEET_ID}/file`)) {
        return new Response(a1SheetPdf('C'), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (url.includes(`/api/documents/${CALIBRATION_HIDDEN_ID}/`))
        return Response.json({ code: 'NOT_FOUND' }, { status: 404 })
      return real(input, init)
    }
  }
}

function Scenario({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note: string
  children: ReactNode
}) {
  return (
    <section
      data-testid={`calibration-scenario-${id}`}
      className="flex w-[680px] max-w-full flex-col gap-2"
    >
      <h2 className="text-section text-foreground">{title}</h2>
      <p className="text-meta text-muted-foreground">{note}</p>
      {children}
    </section>
  )
}

const Receipt = ({ proposalId }: { proposalId: string }) => (
  <CalibrationReceipt proposalId={proposalId} input={CALIBRATION_INPUT} />
)

export default function CalibrationProposalPreviewPage() {
  const ready = useFakeProposalClient(CALIBRATION_PROPOSALS)
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="calibration-proposal-preview"
        className="bg-background flex min-h-screen flex-col items-center gap-10 px-4 py-6 sm:p-10"
      >
        {ready && (
          <>
            <Scenario
              id="pending"
              title="Offen"
              note="Der Ausschnitt mit der markierten Strecke, die Frage, und welcher Maßstab bei „Bestätigen“ gilt."
            >
              <Receipt proposalId={CALIBRATION_DEMO.pending} />
            </Scenario>
            <Scenario
              id="read-only"
              title="Offen, darf nicht entscheiden"
              note="Dieselbe Frage ohne Schaltflächen, mit dem Grund."
            >
              <Receipt proposalId={CALIBRATION_DEMO.readOnly} />
            </Scenario>
            <Scenario
              id="confirmed"
              title="Bestätigt"
              note="Die Quittung: was gilt, wer es bestätigt hat und wann."
            >
              <Receipt proposalId={CALIBRATION_DEMO.confirmed} />
            </Scenario>
            <Scenario id="declined" title="Verworfen" note="Der Maßstab bleibt geschätzt.">
              <Receipt proposalId={CALIBRATION_DEMO.declined} />
            </Scenario>
            <Scenario
              id="refused-no-clip"
              title="Ohne Ausschnitt"
              note="Die Zeichnung lässt sich für diese Person nicht öffnen: kein „Bestätigen“, nur der Grund und „Verwerfen“."
            >
              <Receipt proposalId={CALIBRATION_DEMO.refusedNoClip} />
            </Scenario>
            <Scenario
              id="refused-incomplete"
              title="Unvollständiger Vorschlag"
              note="Dem Vorschlag fehlt die Länge: nichts zu bestätigen."
            >
              <CalibrationReceipt proposalId={CALIBRATION_DEMO.refusedIncomplete} input={{}} />
            </Scenario>
          </>
        )}
      </main>
    </I18nProvider>
  )
}
