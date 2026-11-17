'use client'

import { useEffect, useState, type FC, type ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { UserMessage } from '@/features/chat/components/UserMessage'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import { AgentResponse } from '@/features/chat/components/AgentResponse'
import { FollowUpsRail } from '@/features/chat/components/FollowUpsRail'
import type { CitationSource } from '@/features/chat/types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import type { AnswerCard } from '@/shared/cards/schemas'
import type { MessageStages } from '@/lib/conversations/message-stages'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { AnswerMeta } from '@/lib/conversations/message-answer-meta'
import { useChatStore } from '@/features/chat/store'

const step: StoredThinkingStep = {
  id: 'kb',
  userMessageId: 'msg-1',
  kind: 'sources',
  tool: 'knowledge_search',
  isComplete: true,
  timestamp: '2024-01-15T14:30:00Z',
  traceLanes: [
    {
      key: 'building_law_oib',
      label: 'OIB-Richtlinie',
      hitCount: 3,
      signal: 'law',
      sources: [
        { name: 'OIB-RL_2_Brandschutz.pdf', detail: 'Fluchtwege, Pkt. 3.2' },
        { name: 'OIB-RL_2_Brandschutz.pdf', detail: 'p.18' },
      ],
    },
    {
      key: 'building_law_ris',
      label: 'Bundesrecht',
      hitCount: 2,
      signal: 'law',
      sources: [{ name: 'Bauordnung für Wien', detail: '§ 108 Fluchtwege' }],
    },
    {
      key: 'project',
      label: 'Projektwissen',
      hitCount: 1,
      signal: 'project',
      sources: [{ name: 'Grundriss_EG.pdf', detail: 'Seite 2' }],
    },
  ],
}

const citations: CitationSource[] = [
  {
    id: 'c1',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    fileName: 'OIB-RL_2_Brandschutz.pdf',
    title: 'OIB-Richtlinie 2 · Brandschutz',
    page: 18,
    number: 1,
  },
  {
    id: 'c2',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_ris',
    laneLabel: 'Bundesrecht',
    title: 'Bauordnung für Wien § 108',
    url: 'https://www.ris.bka.gv.at/',
    number: 2,
  },
]

const question =
  'Wie viele Rettungswege brauche ich für ein Bürogebäude der Gebäudeklasse 4 in Wien?'

const answer = `Für ein Bürogebäude der **Gebäudeklasse 4** sind in der Regel **zwei voneinander unabhängige Fluchtwege** erforderlich.

- **Erster Fluchtweg** — ein baulicher Rettungsweg über ein Sicherheitstreppenhaus.
- **Zweiter Fluchtweg** — ein zweiter baulicher Weg oder eine über die Feuerwehr anleiterbare Stelle.

Die maximale Fluchtweglänge bis zum sicheren Bereich beträgt **40 m** [1]; § 108 BO Wien verlangt zusätzlich den zweiten Weg [2].

## Quellen
- [1] [KB] OIB-RL_2_Brandschutz.pdf, p.18
- [2] [RIS] Bauordnung für Wien § 108 — https://www.ris.bka.gv.at/`

const commonThinking = {
  steps: [step],
  userQuestion: question,
  enabledDataSources: ['OIB-Korpus', 'RIS', 'Projektdokumente'],
  messageFiles: [{ id: 'f1', fileName: 'Grundriss_EG.pdf' }],
}

function LiveTurn() {
  return (
    <div className="bg-background flex flex-col gap-5 rounded-2xl border p-5">
      <div className="text-muted-foreground font-mono text-xs">
        ↓ LIVE — thinking, Herleitung expanded, answer absent
      </div>
      <UserMessage content={question} timestamp={new Date('2024-01-15T14:30:00')} />
      <div className="w-[680px] max-w-full">
        <ChatThinking
          {...commonThinking}
          isThinking
          autoOpen
          answerConfidence="high"
          citations={citations}
        />
      </div>
    </div>
  )
}

function CompletedTurn() {
  return (
    <div className="bg-background flex flex-col gap-5 rounded-2xl border p-5">
      <div className="text-muted-foreground font-mono text-xs">
        ↓ COMPLETED — Herleitung collapsed, answer dominant
      </div>
      <UserMessage content={question} timestamp={new Date('2024-01-15T14:30:00')} />
      <div className="w-[680px] max-w-full">
        <ChatThinking
          {...commonThinking}
          isThinking={false}
          autoOpen={false}
          answerConfidence="high"
          citations={citations}
        />
      </div>
      <AgentResponse
        content={answer}
        timestamp={new Date('2024-01-15T14:30:12')}
        answerDurationMs={12_400}
        citations={citations}
        answerConfidence="high"
        answerConfidenceReason="OIB-RL 2 direkt als Quelle belegt"
        routingDecision="shallow"
        messageId="msg-a1"
      />
    </div>
  )
}

const OIB2 = { document: 'OIB-Richtlinie 2', section: 'Tabelle 1b', edition: 'Ausgabe Mai 2023' }
const OIB4 = { document: 'OIB-Richtlinie 4', section: 'Pkt. 2.2', edition: 'Ausgabe Mai 2023' }

const AnswerTurn: FC<{
  label: string
  question: string
  answer: string
  cards?: AnswerCard[]
  citations: CitationSource[]
  confidenceReason: string
  messageId: string
  rail?: { question: string; hint?: string }[]
  stages?: MessageStages
  cardInteractions?: CardInteractions
  answerMeta?: AnswerMeta
  conversationId?: string
  isStreaming?: boolean
  children?: ReactNode
}> = ({
  label,
  question,
  answer,
  cards,
  citations,
  confidenceReason,
  messageId,
  rail,
  stages,
  cardInteractions,
  answerMeta,
  conversationId,
  isStreaming,
  children,
}) => (
  <div className="bg-background flex flex-col gap-5 rounded-2xl border p-5">
    <div className="text-muted-foreground font-mono text-xs">{label}</div>
    {children}
    <UserMessage content={question} timestamp={new Date('2024-01-15T14:30:00')} />
    <div className="w-[680px] max-w-full">
      <ChatThinking
        {...commonThinking}
        userQuestion={question}
        isThinking={false}
        autoOpen={false}
        answerConfidence="high"
        citations={citations}
      />
    </div>
    {/* `gap-4` — the message column's real gap in ChatArea, so the distance
        between the answer and the rail is the production one and not this
        preview panel's own rhythm. */}
    <div className="flex flex-col gap-4">
      <AgentResponse
        content={answer}
        timestamp={new Date('2024-01-15T14:30:12')}
        cards={cards}
        citations={citations}
        conversationId={conversationId}
        answerConfidence="high"
        answerConfidenceReason={confidenceReason}
        routingDecision="shallow"
        messageId={messageId}
        stages={stages}
        cardInteractions={cardInteractions}
        answerMeta={answerMeta}
        isStreaming={isStreaming}
      />
      {rail && (
        <div className="w-[680px] max-w-full">
          <FollowUpsRail items={rail} />
        </div>
      )}
    </div>
  </div>
)

const stairCitations: CitationSource[] = [
  {
    id: 's1',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    fileName: 'OIB-RL_4_Nutzungssicherheit.pdf',
    title: 'OIB-Richtlinie 4 · Nutzungssicherheit',
    page: 7,
    number: 1,
  },
  {
    id: 's2',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_ris',
    laneLabel: 'Bundesrecht',
    title: 'Bauordnung für Wien § 109',
    url: 'https://www.ris.bka.gv.at/',
    number: 2,
  },
]

const STAIR_SOURCES = `## Quellen
- [1] [KB] OIB-RL_4_Nutzungssicherheit.pdf, Pkt. 2.2
- [2] [RIS] Bauordnung für Wien § 109 — https://www.ris.bka.gv.at/`

const fireCitations: CitationSource[] = [
  {
    id: 'f1',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    fileName: 'OIB-RL_2_Brandschutz.pdf',
    title: 'OIB-Richtlinie 2 · Brandschutz',
    page: 12,
    number: 1,
  },
  {
    id: 'f2',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_ris',
    laneLabel: 'Bundesrecht',
    title: 'Bauordnung für Wien §§ 60 ff.',
    url: 'https://www.ris.bka.gv.at/',
    number: 2,
  },
]

const FIRE_SOURCES = `## Quellen
- [1] [KB] OIB-RL_2_Brandschutz.pdf, Tabelle 1b
- [2] [RIS] Bauordnung für Wien §§ 60 ff. — https://www.ris.bka.gv.at/`

const structuredQuestion =
  'Welche Feuerwiderstandsklasse brauchen tragende Bauteile in Gebäudeklasse 5, und erfüllt unser Konzept das?'

const structuredAnswer = `Tragende Bauteile in Gebäudeklasse 5 brauchen **R 90** oberirdisch und **R 90 aus A2** in den unterirdischen Geschoßen [1].

### Oberirdisch und im Keller gilt nicht dasselbe

| Bauteil | Anforderung | Fundstelle |
|---|---|---|
| Tragende Bauteile, oberirdisch | **R 90** | [1] |
| Tragende Bauteile, unterirdisch | **R 90 und A2** | [1] |
| Trennwände zwischen Nutzungseinheiten | **REI 90** | [1] |
| Decken über dem obersten Geschoß | **R 30** | [1] |

### Das Brandschutzkonzept deckt drei von vier Punkten

| Kriterium | Konzept | Status | Fundstelle |
|---|---|---|---|
| Stützen und Wände oberirdisch | R 90 | erfüllt | [1] |
| Kellerdecke | R 90, Baustoff nicht angegeben | teilweise | [1] |
| Wohnungstrennwände | REI 60 | nicht erfüllt | [1] |
| Dachdecke | nicht beschrieben | offen | [1] |

### Eine Abweichung entscheidet die Behörde

\`\`\`mermaid
flowchart TD
  K["Abweichung im Brandschutzkonzept begründen"] --> E["Mit dem Bauansuchen einreichen"]
  E --> B{"Gleichwertiges Schutzniveau?"}
  B -->|ja| J["Bewilligt mit der Baubewilligung"]
  B -->|nein| N["REI 90 ausführen"]
\`\`\`

- [x] Brandschutzkonzept, Stand 3
- [ ] Nachweis der Gleichwertigkeit für die Wohnungstrennwände

${FIRE_SOURCES}`

const ledeCardQuestion =
  'Erfüllt der Treppenlauf im Haus A die Schrittmaßregel bei 17 cm Steigung und 30 cm Auftritt?'

const ledeCardAnswer = `Ja — der Lauf hält die Schrittmaßregel ein: aus 17 cm Steigung und 30 cm Auftritt ergibt sich ein Schrittmaß innerhalb des zulässigen Bandes von 59 bis 65 cm [1].

Maßgeblich ist nicht die einzelne Stufe, sondern das Verhältnis von Steigung und Auftritt über den gesamten Lauf. Die Regel bildet die natürliche Schrittlänge ab — zweimal die Steigung plus einmal den Auftritt — und hält den Lauf begehbar, ohne dass die Schrittfolge auf halber Höhe wechselt.

[[card:1]]

Die aus dem Einreichplan abgegriffene Steigung trägt eine Toleranz von ± 0,5 cm. Das Ergebnis bleibt damit in jeder Lage innerhalb der Regel; erst ab 65,5 cm wäre der Lauf gesondert nachzuweisen.

Für Wohngebäude der Gebäudeklasse 4 ist zusätzlich eine nutzbare Laufbreite von mindestens 1,20 m einzuhalten [2]. Sie wird von der Schrittmaßregel nicht berührt und ist getrennt zu prüfen.

${STAIR_SOURCES}`

const ledeCards: AnswerCard[] = [
  {
    type: 'calculation',
    title: 'Schrittmaßregel – Treppenlauf Haus A',
    steps: [
      {
        label: 'Schrittmaß',
        operation: 'sum',
        unit: 'cm',
        operands: [
          {
            label: 'Steigung',
            value: 17,
            unit: 'cm',
            factor: 2,
            provenance: 'computed',
            tolerance: 0.5,
            source: 'Einreichplan, Schnitt A-A',
          },
          { label: 'Auftritt', value: 30, unit: 'cm', provenance: 'declared' },
        ],
      },
    ],
    limit: {
      comparator: 'between',
      value: 59,
      upper: 65,
      label: 'Schrittmaßregel',
      reference: OIB4,
    },
  } as AnswerCard,
]

const streamingQuestion =
  'Welche Feuerwiderstandsklasse brauchen tragende Wände in GK 5 und wie unterscheidet sich das vom obersten Geschoß?'

const streamingFinal = `Tragende Wände in GK 5 brauchen in sonstigen oberirdischen Geschoßen **R 90**; im obersten Geschoß gilt **R 60** [1].

| Lage | Feuerwiderstand | Fundstelle |
|---|---|---|
| Sonstige oberirdische Geschoße, bis zu 6 oberirdische Geschoße | R 90 | [1] |
| Sonstige oberirdische Geschoße, mehr als 6 oberirdische Geschoße | R 90 und A2 | [1] |
| Oberstes Geschoß | R 60 | [1] |

Für GK 5 mit höchstens 6 oberirdischen Geschoßen genügt unter der Bedingung der Fußnote (5) R 60 auch in den beiden obersten Geschoßen: Die übrigen oberirdischen Geschoße müssen dann R 90 und A2 erfüllen [1].`

const streamingPartial = `Tragende Wände in GK 5 brauchen in sonstigen oberirdischen Geschoßen **R 90**; im obersten Geschoß gilt **R 60** [1].

| Lage | Feuerwiderstand | Fundstelle |
|---|---|---|
| Sonstige oberirdische Geschoße, bis zu 6 oberirdische Geschoße | R 90 | [1] |
| Sonstige oberirdische Geschoße, mehr als 6`

const streamingSettled = `${streamingFinal}

## Quellen
- [1] [KB] OIB-RL_2_Brandschutz.pdf, p.12`

const variantsQuestion =
  'Für den zweiten Fluchtweg in GK 4 überlegen wir eine Außentreppe oder ein zweites Treppenhaus. Was müsste ich jeweils nachweisen?'

const variantsAnswer = `In GK 4 verlangt Tabelle 3 für ein zweites Treppenhaus oberirdisch Wände REI 60 und Treppenläufe R 60; eine Außentreppe muss aus A2 bestehen und darf im Brandfall nicht durch Flammeneinwirkung oder gefahrbringende Strahlungswärme beeinträchtigt werden [1].

Der zusätzliche Fluchtweg muss unabhängig sein und zu einem weiteren Treppenhaus oder einer weiteren Außentreppe gemäß Tabelle 3 führen; für diesen Weg ist die Gehweglänge nicht begrenzt [2]. Für beide Varianten ist außerdem nachzuweisen, dass der Ausgang zu einem sicheren Ort im Freien führt und die Treppe hinsichtlich ihrer nutzbaren Breite zur Personenzahl passt [1][3].

[[card:1]]

Die Übersicht geht von OIB-Richtlinie 2, Ausgabe Mai 2023, aus. Ob diese Ausgabe in Ihrem Bundesland verbindlich gilt und ob landesrechtliche Abweichungen bestehen, ist ohne Angabe des Bundeslands offen.

## Quellen
- [1] [KB] oib-rl_2_ausgabe_mai_2023.pdf, p.23
- [2] [KB] oib-rl_2_ausgabe_mai_2023.pdf, p.13
- [3] [KB] oib-rl_4_ausgabe_mai_2023.pdf, p.6`

const variantsCards: AnswerCard[] = [
  {
    type: 'surface',
    title: 'Nachweis je Variante',
    components: [
      {
        id: 'root',
        component: 'Tabs',
        tabs: [
          { title: 'Außentreppe', child: 'aussen' },
          { title: 'Zweites Treppenhaus', child: 'innen' },
        ],
      },
      {
        id: 'aussen',
        component: 'Text',
        text: [
          '| Nachweis | Was darzustellen bzw. zu belegen ist | Fundstelle |',
          '|---|---|---|',
          '| Unabhängiger Fluchtweg | Wegführung aus den betroffenen Geschoßen zur Außentreppe; Ausgang zu einem sicheren Ort im Freien | OIB-RL 2, Pkt. 5.1.4 und Tabelle 3 [2][1] |',
          '| Treppenkonstruktion | Ausführung in A2; keine Beeinträchtigung durch Flammeneinwirkung oder gefahrbringende Strahlungswärme | OIB-RL 2, Tabelle 3 [1] |',
          '| Nutzbarkeit | Lichte Treppenlaufbreite anhand der maximal gleichzeitig auf die Treppe angewiesenen Personen | OIB-RL 4, Pkt. 2.4 [3] |',
        ].join('\n'),
      },
      {
        id: 'innen',
        component: 'Text',
        text: [
          '| Nachweis | Was darzustellen bzw. zu belegen ist | Fundstelle |',
          '|---|---|---|',
          '| Unabhängiger Fluchtweg | Wegführung aus den betroffenen Geschoßen zum zweiten Treppenhaus; Ausgang zu einem sicheren Ort im Freien | OIB-RL 2, Pkt. 5.1.4 und Pkt. 5.1.1 [2][1] |',
          '| Wände und Decke | Oberirdisch: Wände REI 60; unterirdisch: REI 90 und A2; Decke über dem Treppenhaus REI 60 | OIB-RL 2, Tabelle 3 [1] |',
          '| Türen und Treppenläufe | Türen gemäß Tabelle 3 nach angrenzender Nutzung; Treppenläufe R 60 | OIB-RL 2, Tabelle 3 [1] |',
          '| Nutzbarkeit | Lichte Treppenlaufbreite anhand der maximal gleichzeitig auf die Treppe angewiesenen Personen | OIB-RL 4, Pkt. 2.4 [3] |',
        ].join('\n'),
      },
    ],
  } as unknown as AnswerCard,
]

const variantsCitations: CitationSource[] = [1, 2, 3].map((number) => ({
  id: `v${number}`,
  content: '',
  timestamp: new Date('2026-09-24T11:40:00'),
  isCited: true,
  kind: 'building_law',
  lane: 'building_law_oib',
  laneLabel: 'OIB-Richtlinie',
  fileName: number === 3 ? 'oib-rl_4_ausgabe_mai_2023.pdf' : 'oib-rl_2_ausgabe_mai_2023.pdf',
  title: number === 3 ? 'OIB-Richtlinie 4 · Nutzungssicherheit' : 'OIB-Richtlinie 2 · Brandschutz',
  page: number === 1 ? 23 : number === 2 ? 13 : 6,
  number,
}))

const twoCardsQuestion =
  'Welche Gebäudeklasse hat unser Wohnhaus — und hält der Treppenlauf die Schrittmaßregel ein?'

const twoCardsAnswer = `Das Wohnhaus liegt mit einem obersten Fluchtniveau von 9,20 m in **Gebäudeklasse 4**; die Grenze zu GK 5 liegt bei 11 m [1].

Maßgeblich ist das Fluchtniveau des obersten Geschoßes mit Aufenthaltsräumen, gemessen über dem tiefsten Punkt des angrenzenden Geländes:

[[card:1]]

Verschiebt sich das Fluchtniveau im Zuge der Planung über 11 m, gelten die Anforderungen der Gebäudeklasse 5 [1].

Der Treppenlauf hält die Schrittmaßregel ein; die Rechnung steht unter der Antwort.

${FIRE_SOURCES}`

const twoCards: AnswerCard[] = [
  {
    type: 'building_section',
    title: 'Gebäudeschnitt – Höhenprüfung GK 4',
    storeys: [
      { label: 'KG', height_m: 2.5, below_grade: true },
      { label: 'EG', height_m: 3.2 },
      { label: '1.OG', height_m: 3.0 },
      { label: '2.OG', height_m: 3.0 },
      { label: '3.OG', height_m: 3.0 },
    ],
    markers: [
      { label: 'Fluchtniveau', height_m: 9.2, kind: 'escape_level' },
      { label: 'GK4-Grenze', height_m: 11, kind: 'threshold' },
    ],
    reference: OIB2,
  } as AnswerCard,
  ...ledeCards,
]

const followUpsQuestion = 'Was ist das Fluchtniveau und wie wird es gemessen?'

const followUpsAnswer = `Das Fluchtniveau ist der **Fußboden des obersten Geschoßes mit Aufenthaltsräumen**, gemessen über dem tiefsten Punkt des angrenzenden Geländes. Es entscheidet über die Gebäudeklasse und damit über fast jede Brandschutzanforderung [1].

Gemessen wird lotrecht: vom tiefsten Punkt des Geländes an der Gebäudeaußenseite bis zur Oberkante des Fußbodens im obersten Geschoß mit Aufenthaltsräumen. Dachgeschoße zählen mit, sobald sie Aufenthaltsräume enthalten; ein reiner Technik- oder Abstellraum darüber bleibt außer Betracht.

Bei Hanglagen ist der tiefste Geländepunkt maßgeblich, nicht der Eingang. Das ist der häufigste Grund, warum ein Projekt in der Einreichung eine Klasse höher landet als in der Vorbemessung angenommen [2].

${STAIR_SOURCES}`

const followUpsStageItems = [
  {
    question: 'Welche Gebäudeklasse ergibt sich für mein Projekt?',
    hint: 'aus dem Grundriss und dem Schnitt',
  },
  {
    question: 'Was ändert sich beim Sprung von GK 4 auf GK 5?',
    hint: 'Vergleich der Anforderungen',
  },
  { question: 'Zählt mein Dachgeschoß als Aufenthaltsraum?' },
  { question: 'Wie weise ich das Fluchtniveau im Einreichplan nach?' },
]

const memoryQuestion = 'Zählt das Dachgeschoß als Aufenthaltsraum, wenn dort nur ein Büro liegt?'

const memoryAnswer = `Ja. Ein Büro ist ein **Aufenthaltsraum** im Sinne der OIB-Richtlinien, weil es zum nicht nur vorübergehenden Aufenthalt von Menschen bestimmt ist. Damit zählt das Dachgeschoß für das Fluchtniveau mit [1].

Für Ihr Projekt heißt das: das oberste Geschoß mit Aufenthaltsräumen ist das Dachgeschoß, und das Fluchtniveau ist von dessen Fußboden zu messen — nicht vom darunterliegenden Regelgeschoß.

Ein reiner Technik-, Abstell- oder Trockenraum bliebe außer Betracht; sobald dort ein Arbeitsplatz eingerichtet ist, ändert sich die Beurteilung [2].

${STAIR_SOURCES}`

const memoryStage: MessageStages = {
  memoryReflection: {
    items: [
      {
        id: 'row-1',
        kind: 'derived_fact',
        content:
          'Das Dachgeschoß enthält ein Büro und zählt damit als Geschoß mit Aufenthaltsräumen.',
      },
      {
        id: 'row-2',
        kind: 'constraint',
        content: 'Das Fluchtniveau ist ab Oberkante Fußboden des Dachgeschoßes zu messen.',
      },
    ],
  },
}

const memoryCorrectionCards: AnswerCard[] = [
  {
    type: 'memory_proposal',
    title: 'Korrektur merken?',
    content: 'Das Fluchtniveau beträgt 11,40 m (Fußboden Dachgeschoß); das Gebäude liegt in Gebäudeklasse 5.',
    kind: 'derived_fact',
    confidence: 'high',
    supersedes: 'Das Fluchtniveau beträgt 9,80 m; das Gebäude liegt in Gebäudeklasse 4.',
    proposal_id: null,
  } as AnswerCard,
]

const memoryCorrectionDecisions: CardInteractions = {
  'memory_proposal-0': { decision: 'savedProject', decidedAt: '2024-01-15T14:30:20.000Z' },
}

const memoryCorrectionStage: MessageStages = {
  memoryReflection: {
    items: [
      {
        id: 'row-3',
        kind: 'constraint',
        content: 'Das Fluchtniveau ist ab Oberkante Fußboden des Dachgeschoßes zu messen.',
      },
    ],
  },
}

const anatomyQuestion = 'Wie hoch muss das Geländer an der Dachterrasse sein?'

const anatomyAnswer = `Maßgeblich ist die Absturzhöhe, nicht das Geschoß: gemessen wird von der Oberkante des begehbaren Belags bis zur tiefer liegenden angrenzenden Fläche — hier rund 13,2 m bis zum Gelände, also klar über der 12-m-Grenze [1].

Die Füllung ist getrennt zu beurteilen. Öffnungen dürfen 12 cm nicht überschreiten, und zwischen 20 und 60 cm über dem Belag sind waagrechte Elemente unzulässig, weil sie als Aufstiegshilfe wirken [1].

[[callout]]

Für Wien verlangt § 109 BO zusätzlich die Darstellung der Verankerung im Einreichplan; die Ausführung selbst bleibt Sache der Detailplanung [2].

${STAIR_SOURCES}`

const anatomyMeta: AnswerMeta = {
  v: 1,
  summary:
    'Für die Dachterrasse sind 1,20 m Umwehrungshöhe erforderlich, weil die Absturzhöhe mit rund 13,2 m über der 12-m-Grenze liegt; gemessen wird ab Oberkante des begehbaren Belags.',
  verdict: {
    value: '1,20 m',
    subject: 'Erforderliche Höhe der Umwehrung',
    reference: { document: 'OIB-Richtlinie 4', section: 'Pkt. 4.1', edition: 'Ausgabe Mai 2023' },
  },
  callout: {
    kind: 'warning',
    text: 'Aufkantungen und Pflanztröge am Rand zählen zur Standfläche: die 1,20 m sind ab deren Oberkante zu messen.',
  },
  takeaways: [
    {
      text: 'Über 12 m Absturzhöhe sind 1,20 m Umwehrungshöhe erforderlich',
      detail: 'Unter 12 m genügen 1,00 m; die Grenze entscheidet, nicht das Geschoß.',
    },
    { text: 'Öffnungen der Füllung höchstens 12 cm' },
    { text: 'Keine waagrechten Elemente zwischen 20 und 60 cm über dem Belag' },
  ],
}

const FEEDBACK_STATES: Record<
  string,
  { messageId: string; verdict: string; reason: string | null; comment: string | null }[]
> = {
  'conv-feedback-rest': [],
  'conv-feedback-down': [
    { messageId: 'msg-feedback-down', verdict: 'down', reason: 'inaccurate', comment: null },
  ],
}

if (typeof window !== 'undefined') {
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/feedback/answers')) {
      const conversationId = new URL(url, 'http://x').searchParams.get('conversationId') ?? ''
      return new Response(JSON.stringify({ feedback: FEEDBACK_STATES[conversationId] ?? [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return real(input, init)
  }
}

const feedbackQuestion =
  'Wie breit muss die Haupttreppe in einem Wohnhaus der Gebäudeklasse 4 sein?'

const feedbackAnswer = `Die nutzbare **Laufbreite** der Haupttreppe muss mindestens **1,20 m** betragen. Gemessen wird zwischen den begrenzenden Bauteilen, Handläufe dürfen bis 10 cm je Seite einragen [1].

Für Wien konkretisiert § 111 BO die Ausführung: die Breite ist über den gesamten Lauf einzuhalten, Einbauten und Verziehungen dürfen sie an keiner Stelle unterschreiten [2].

${STAIR_SOURCES}`

function SeedRetryAction() {
  useEffect(() => {
    useChatStore.setState({
      chatSendFn: () => undefined,
      currentConversation: {
        id: 'conv-feedback-down',
        messages: [
          { id: 'msg-feedback-down-q', role: 'user', messageType: 'user', content: feedbackQuestion },
          { id: 'msg-feedback-down', role: 'assistant', messageType: 'assistant', content: feedbackAnswer },
        ],
      } as never,
    })
  }, [])
  return null
}

function SeedMemoryDecision() {
  useEffect(() => {
    useChatStore.setState({
      currentConversation: {
        id: 'conv-memory-corrected',
        messages: [
          {
            id: 'msg-memory-corrected',
            role: 'assistant',
            messageType: 'assistant',
            content: memoryAnswer,
            cards: memoryCorrectionCards,
            cardInteractions: memoryCorrectionDecisions,
          },
        ],
      } as never,
    })
  }, [])
  return null
}

const ANSWER_VARIANTS = [
  'feedback-open',
  'lede-card',
  'two-cards',
  'follow-ups-rail',
  'memory-chip',
  'anatomy',
  'structured',
  'variants',
  'streaming',
] as const
type AnswerVariant = (typeof ANSWER_VARIANTS)[number]

const isAnswerVariant = (value: string | null): value is AnswerVariant =>
  ANSWER_VARIANTS.includes(value as AnswerVariant)

function AnswerLayer({ variant }: { variant: AnswerVariant }) {
  if (variant === 'feedback-open') {
    return (
      <>
        <SeedRetryAction />
        <AnswerTurn
          label="↓ AT REST — the footnote is one 24px line: copy, export, the question, two thumbs"
          question={feedbackQuestion}
          answer={feedbackAnswer}
          citations={stairCitations}
          confidenceReason="Laufbreite direkt aus OIB-RL 4 und § 111 BO Wien belegt"
          messageId="msg-feedback-rest"
          conversationId="conv-feedback-rest"
        />
        <AnswerTurn
          label="↓ NOT HELPFUL, REASON CHOSEN — 'Gründlicher neu beantworten' sits beside the thumbs; the disclosure takes the next line, the row above it does not move"
          question={feedbackQuestion}
          answer={feedbackAnswer}
          citations={stairCitations}
          confidenceReason="Laufbreite direkt aus OIB-RL 4 und § 111 BO Wien belegt"
          messageId="msg-feedback-down"
          conversationId="conv-feedback-down"
        />
      </>
    )
  }

  if (variant === 'anatomy') {
    return (
      <AnswerTurn
        label="↓ NATIVE ANATOMY — verdict masthead above the prose, callout anchored by [[callout]], takeaways closing"
        question={anatomyQuestion}
        answer={anatomyAnswer}
        citations={stairCitations}
        confidenceReason="Absturzhöhe am Modell gemessen, Grenzwert direkt aus OIB-RL 4 belegt"
        messageId="msg-anatomy"
        answerMeta={anatomyMeta}
      />
    )
  }

  if (variant === 'structured') {
    return (
      <AnswerTurn
        label="↓ MARKDOWN FIRST — tables with a Fundstelle column, status words as chips, a drawing where the answer forks, a task list; no card"
        question={structuredQuestion}
        answer={structuredAnswer}
        citations={fireCitations}
        confidenceReason="Anforderungen direkt aus OIB-RL 2 Tabelle 1b belegt"
        messageId="msg-structured"
      />
    )
  }

  if (variant === 'lede-card') {
    return (
      <AnswerTurn
        label="↓ LEDE + INLINE CARD — first paragraph typeset as the lede, calculation spliced in by [[card:1]]"
        question={ledeCardQuestion}
        answer={ledeCardAnswer}
        cards={ledeCards}
        citations={stairCitations}
        confidenceReason="Schrittmaßregel direkt aus OIB-RL 4 belegt"
        messageId="msg-lede-card"
      />
    )
  }

  if (variant === 'streaming') {
    return (
      <>
        <AnswerTurn
          label="↓ STREAMING — the prose as the final call writes it; each [N] a pending pill until its source is settled"
          question={streamingQuestion}
          answer={streamingPartial}
          citations={[]}
          confidenceReason="—"
          messageId="msg-streaming-partial"
          isStreaming
        />
        <AnswerTurn
          label="↓ SETTLED MID-STREAM — the text closed, its citations verified: real pills, still arriving, no cards yet"
          question={streamingQuestion}
          answer={streamingSettled}
          citations={fireCitations.slice(0, 1)}
          confidenceReason="Anforderungen direkt aus OIB-RL 2 Tabelle 1b belegt"
          messageId="msg-streaming-settled"
          isStreaming
        />
        <AnswerTurn
          label="↓ FINAL — the terminal frame: the same numbers, the answer complete"
          question={streamingQuestion}
          answer={streamingSettled}
          citations={fireCitations.slice(0, 1)}
          confidenceReason="Anforderungen direkt aus OIB-RL 2 Tabelle 1b belegt"
          messageId="msg-streaming-final"
        />
      </>
    )
  }

  if (variant === 'variants') {
    return (
      <AnswerTurn
        label="↓ VARIANTS (live answer) — shared prose, then Tabs holding one Text table per variant"
        question={variantsQuestion}
        answer={variantsAnswer}
        cards={variantsCards}
        citations={variantsCitations}
        confidenceReason="OIB-Mai-2023-Anforderungen belegt; Bundesland und Nutzung sind nicht angegeben"
        messageId="msg-variants"
      />
    )
  }

  if (variant === 'two-cards') {
    return (
      <AnswerTurn
        label="↓ TWO CARDS — building_section placed inline, calculation unplaced → fallback block above the footer"
        question={twoCardsQuestion}
        answer={twoCardsAnswer}
        cards={twoCards}
        citations={fireCitations}
        confidenceReason="Tabelle 1b der OIB-RL 2 direkt als Quelle belegt"
        messageId="msg-two-cards"
      />
    )
  }

  if (variant === 'follow-ups-rail') {
    return (
      <>
        <AnswerTurn
          label="↓ AS THE ANSWER LANDS — the stage has not answered yet, and nothing is held open for it"
          question={followUpsQuestion}
          answer={followUpsAnswer}
          citations={stairCitations}
          confidenceReason="Definition und Messregel direkt aus OIB-RL 4 belegt"
          messageId="msg-follow-ups-before"
        />
        <AnswerTurn
          label="↓ TWO SECONDS LATER — the rail appended BELOW the answer card, outside it, in the same column"
          question={followUpsQuestion}
          answer={followUpsAnswer}
          citations={stairCitations}
          confidenceReason="Definition und Messregel direkt aus OIB-RL 4 belegt"
          messageId="msg-follow-ups-after"
          rail={followUpsStageItems}
        />
      </>
    )
  }

  return (
    <>
      <SeedMemoryDecision />
      <AnswerTurn
        label="↓ NOTHING WAS RECORDED — the stage ran and declined, which is its most common correct outcome"
        question={memoryQuestion}
        answer={memoryAnswer}
        citations={stairCitations}
        confidenceReason="Definition des Aufenthaltsraums direkt aus OIB-RL 4 belegt"
        messageId="msg-memory-empty"
      />
      <AnswerTurn
        label="↓ TWO WERE — the chip sits on the meta row beside „Details“, not inside it; one tap names each item and where it came from"
        question={memoryQuestion}
        answer={memoryAnswer}
        citations={stairCitations}
        confidenceReason="Definition des Aufenthaltsraums direkt aus OIB-RL 4 belegt"
        messageId="msg-memory-noted"
        stages={memoryStage}
      />
      <AnswerTurn
        label="↓ ONE NOTE CORRECTED — „Gedächtnis aktualisiert“ with its own glyph; the popover lists the correction first, the retired note struck through"
        question={memoryQuestion}
        answer={memoryAnswer}
        cards={memoryCorrectionCards}
        cardInteractions={memoryCorrectionDecisions}
        citations={stairCitations}
        confidenceReason="Definition des Aufenthaltsraums direkt aus OIB-RL 4 belegt"
        messageId="msg-memory-corrected"
        stages={memoryCorrectionStage}
      />
    </>
  )
}

export default function ChatTurnPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <ChatTurnPreview />
    </I18nProvider>
  )
}

function ChatTurnPreview() {
  const [variant, setVariant] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setVariant(new URLSearchParams(window.location.search).get('variant'))
  }, [])

  if (variant === undefined) return null

  const heading = isAnswerVariant(variant)
    ? `/dev/chat-turn?variant=${variant} — the answer layer inside a real turn`
    : '/dev/chat-turn — live (reasoning expanded) → completed (answer-dominant)'

  return (
    <main className="bg-muted/30 min-h-dvh px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <h1
          className="text-muted-foreground font-mono text-xs"
          data-testid={isAnswerVariant(variant) ? 'answer-layer-preview' : 'chat-turn-preview'}
        >
          {heading}
        </h1>
        {isAnswerVariant(variant) ? (
          <AnswerLayer variant={variant} />
        ) : (
          <>
            <LiveTurn />
            <CompletedTurn />
          </>
        )}
      </div>
    </main>
  )
}
