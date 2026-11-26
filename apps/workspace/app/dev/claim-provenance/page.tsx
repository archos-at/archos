'use client'

import { notFound } from 'next/navigation'
import type { FC, ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { AgentResponse } from '@/features/chat/components/AgentResponse'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import { ConfidenceChip } from '@/features/chat/components/ConfidenceChip'
import { mapServerMessageToChatMessage } from '@/features/chat/lib/server-message-mapper'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import { UNBACKED } from '../_fixtures/stored-answers'

const at = new Date('2026-10-27T09:30:00')

const CLEAN: ConfidenceCheck = { status: 'judged', level: 'high', findings: [], sourcesChecked: 3 }

const NOTHING_CITED: ConfidenceCheck = {
  status: 'judged',
  level: 'medium',
  findings: [],
  sourcesChecked: 0,
}

const CONTRADICTED: ConfidenceCheck = {
  status: 'judged',
  level: 'low',
  sourcesChecked: 2,
  findings: [
    {
      statement: 'Die Treppe ist 1,50 m breit',
      problem: 'contradicted',
      reason: 'Der Schnitt nennt 1,10 m Laufbreite.',
      source: '[1] Schnitt A-A.pdf, S. 2',
    },
  ],
}

const SILENT_AND_UNCITED: ConfidenceCheck = {
  status: 'judged',
  level: 'medium',
  sourcesChecked: 1,
  findings: [
    {
      statement: 'Die Absturzsicherung muss ab 12 m Absturzhöhe 1,10 m hoch sein',
      problem: 'unbacked',
      reason: 'Die zitierte Stelle behandelt nur Wohnungstreppen.',
      source: '[2] OIB-Richtlinie 4, Pkt. 4.2.1',
    },
    {
      statement: 'Ein zweiter Fluchtweg ist erforderlich',
      problem: 'unbacked',
      reason: '',
      source: 'none',
    },
  ],
}

const OLD_RULE: ConfidenceCheck = {
  status: 'judged',
  level: 'low',
  findings: [
    {
      statement: 'Die Treppe ist 1,50 m breit',
      problem: 'contradicted',
      reason: 'Der Schnitt nennt 1,10 m Laufbreite.',
      source: '[1] Schnitt A-A.pdf, S. 2',
    },
  ],
}

const storedMetadata = UNBACKED.answer.metadata as Record<string, Record<string, unknown>>

const contradictedAnswer = mapServerMessageToChatMessage({
  ...UNBACKED.answer,
  metadata: {
    ...storedMetadata,
    provenance: {
      ...storedMetadata.provenance,
      confidenceCheck: {
        status: 'judged',
        level: 'low',
        sourcesChecked: 2,
        findings: [
          {
            statement: 'Im Burgenland gilt die OIB-Richtlinie 4, Ausgabe April 2019, seit 10. April 2021.',
            problem: 'contradicted',
            reason: 'Die zitierte Fassung von § 43 ist von 2016 und nennt kein Inkrafttreten der Ausgabe April 2019.',
            source: '[2] Burgenländische Bauverordnung 2008, § 43 (Fassung 2016-10-25)',
          },
        ],
      },
    },
  },
})

const Block: FC<{ title: string; note: string; testId?: string; children: ReactNode }> = ({
  title,
  note,
  testId,
  children,
}) => (
  <section className="flex flex-col gap-3" data-testid={testId}>
    <div>
      <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
    {children}
  </section>
)

function Preview() {
  return (
    <main
      data-testid="claim-provenance-preview"
      className="text-foreground mx-auto flex w-full max-w-[760px] flex-col gap-10 p-4 sm:p-6"
    >
      <Block
        testId="chip-clean"
        title="Zitate geprüft, nichts gefunden"
        note="Drei zitierte Quellen gelesen, keine weicht ab, keine Rechtsaussage ohne Fundstelle."
      >
        <div>
          <ConfidenceChip confidence="high" check={CLEAN} />
        </div>
      </Block>
      <Block
        testId="chip-nothing-cited"
        title="Nichts zitiert"
        note="Die Antwort zitiert keine Quelle: die Stufe bleibt die Einschätzung des Assistenten."
      >
        <div>
          <ConfidenceChip confidence="medium" check={NOTHING_CITED} />
        </div>
      </Block>
      <Block
        testId="chip-contradicted"
        title="Eine Quelle sagt etwas anderes"
        note="Die einzige Prüfung, die die Antwort auf niedrig setzt und den Kopf der Herleitung erreicht."
      >
        <div>
          <ConfidenceChip confidence="low" check={CONTRADICTED} />
        </div>
      </Block>
      <Block
        testId="chip-silent-uncited"
        title="Quelle schweigt, Rechtsaussage ohne Fundstelle"
        note="Beides hält die Stufe bei mittel; der Kopf bleibt ruhig."
      >
        <div>
          <ConfidenceChip confidence="medium" check={SILENT_AND_UNCITED} />
        </div>
      </Block>
      <Block
        testId="header-contradicted"
        title="Kopf der Herleitung mit Widerspruch"
        note="Gespeicherte Antwort, eine zitierte Stelle widerspricht ihrer Quelle."
      >
        <div className="w-[680px] max-w-full">
          <ChatThinking
            steps={[]}
            isThinking={false}
            defaultOpen={false}
            userQuestion={UNBACKED.question}
            answerConfidence={contradictedAnswer?.answerConfidence}
            citations={contradictedAnswer?.citations}
            confidenceCheck={contradictedAnswer?.confidenceCheck}
            answerText={contradictedAnswer?.content}
            answerId={contradictedAnswer?.id}
            retrievalLedger={contradictedAnswer?.retrievalLedger}
          />
        </div>
        <div className="w-[380px] max-w-full">
          <ChatThinking
            steps={[]}
            isThinking={false}
            defaultOpen={false}
            userQuestion={UNBACKED.question}
            answerConfidence={contradictedAnswer?.answerConfidence}
            citations={contradictedAnswer?.citations}
            confidenceCheck={contradictedAnswer?.confidenceCheck}
            answerText={contradictedAnswer?.content}
            answerId={contradictedAnswer?.id}
            retrievalLedger={contradictedAnswer?.retrievalLedger}
          />
        </div>
      </Block>
      <Block
        title="Geprüfte Antwort"
        note="Der Chip steht unter der Antwort, wo der Leser ihn findet."
      >
        <AgentResponse
          content="Die Treppe ist 1,50 m breit [1]. Ein zweiter Fluchtweg ist erforderlich."
          messageId="check-judged"
          timestamp={at}
          answerConfidence="low"
          answerConfidenceVersion={2}
          confidenceCheck={CONTRADICTED}
        />
      </Block>
      <Block
        title="Prüfung nach der alten Regel"
        note="Ohne Zahl der geprüften Quellen: die Stufe ohne Befunde."
      >
        <div>
          <ConfidenceChip confidence="low" version={2} check={OLD_RULE} />
        </div>
      </Block>
      <Block
        title="Belegprüfung nicht verfügbar"
        note="Das Prüfmodell lief nicht (kein Modell, Zeitüberschreitung, Fehler): keine Einschätzung, und der Chip sagt es."
      >
        <div>
          <ConfidenceChip confidence={null} check={{ status: 'unavailable', findings: [] }} />
        </div>
      </Block>
      <Block
        title="Die Suche fand nichts"
        note="Die Antwort steht da, mit dem Hinweis darunter; wo sie trotzdem zitiert, steht „[Beleg nicht verifiziert]“."
      >
        <AgentResponse
          content="Hochhäuser regelt die OIB-Richtlinie 2.3 [Beleg nicht verifiziert]. Ab 22 m Fluchtniveau gelten zusätzliche Anforderungen."
          messageId="check-nothing-found"
          timestamp={at}
          routingDecision="shallow"
          answerConfidence="low"
          answerConfidenceVersion={2}
          confidenceCheck={{ status: 'judged', level: 'low', findings: [] }}
          lookupFoundNothing
        />
      </Block>
      <Block
        title="Gespeicherte Antwort von vorher"
        note="Ohne Prüfung: die Stufe und die Texte der Regel, unter der sie gespeichert wurde."
      >
        <div>
          <ConfidenceChip confidence="low" cappedReason="ungrounded" />
        </div>
      </Block>
    </main>
  )
}

export default function ClaimProvenancePreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
