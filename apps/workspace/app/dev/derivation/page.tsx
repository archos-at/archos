'use client'

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import type { CitationSource } from '@/features/chat/types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import {
  MOCKUP_QUESTION,
  failedCallCitations,
  failedCallScene,
  filesystemCitations,
  filesystemEdgesScene,
  filesystemScene,
  foldScene,
  manyCallsScene,
  mockupCitations,
  mockupLiveScene,
  mockupScene,
  singleReadCitations,
  singleReadScene,
} from '@/test-utils/work-list-scenes'
import { mapServerMessageToChatMessage } from '@/features/chat/lib/server-message-mapper'
import { ASKED_BACK, CITED_QUESTION, UNBACKED, type StoredAnswer } from '../_fixtures/stored-answers'

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
    {
      key: 'office',
      label: 'Büroablage',
      hitCount: 1,
      signal: 'office',
      sources: [{ name: 'Brandschutzkonzept_2023.pdf', detail: 'Referenzprojekt' }],
    },
  ],
}

const citations: CitationSource[] = [
  {
    id: 'c1',
    content: '[KB] OIB-RL_2_Brandschutz.pdf, p.18',
    citationKey: 'OIB-RL_2_Brandschutz.pdf, p.18',
    fileName: 'OIB-RL_2_Brandschutz.pdf',
    collection: 'oib_knowledge',
    title: 'OIB-Richtlinie 2 – Brandschutz',
    origin: 'kb',
    timestamp: new Date('2024-01-15T14:30:00'),
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    page: 18,
    number: 1,
    isCited: true,
  },
  {
    id: 'c2',
    content: '[RIS] Bauordnung für Wien § 108',
    url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006',
    title: 'Bauordnung für Wien',
    origin: 'ris',
    timestamp: new Date('2024-01-15T14:30:00'),
    kind: 'building_law',
    lane: 'building_law_ris',
    laneLabel: 'Bundesrecht',
    number: 2,
    isCited: true,
  },
]

const defaultCommon = {
  steps: [step],
  isThinking: false as const,
  defaultOpen: true,
  userQuestion:
    'Wie viele Rettungswege brauche ich für ein Bürogebäude der Gebäudeklasse 4 in Wien?',
  answerConfidence: 'high' as const,
  citations,
  enabledDataSources: ['OIB-Korpus', 'RIS', 'Projektdokumente'],
  messageFiles: [{ id: 'f1', fileName: 'Grundriss_EG.pdf' }],
}

const denseStep: StoredThinkingStep = {
  ...step,
  id: 'kb-dense',
  traceLanes: [
    {
      key: 'building_law_oib',
      label: 'OIB-Richtlinie',
      hitCount: 5,
      signal: 'law',
      sources: [
        { name: 'oib-rl_2_ausgabe_mai_2023.pdf', detail: 'p.12' },
        { name: 'oib-rl_2.3_ausgabe_mai_2023.pdf', detail: 'p.4' },
        { name: 'oib-rl_4_ausgabe_mai_2023.pdf', detail: 'p.9' },
      ],
    },
    {
      key: 'building_law_oib_explanatory_note',
      label: 'OIB-Erläuterung',
      hitCount: 2,
      signal: 'law',
      sources: [{ name: 'erlaeuterungen_oib-rl_2_ausgabe_mai_2023.pdf', detail: 'p.7' }],
    },
    {
      key: 'building_law_ris',
      label: 'Bundesrecht',
      hitCount: 3,
      signal: 'law',
      sources: [
        { name: 'Bauordnung für Wien', detail: '§ 108 Fluchtwege' },
        { name: 'Wiener Garagengesetz', detail: '§ 4' },
      ],
    },
    {
      key: 'project',
      label: 'Projektwissen',
      hitCount: 2,
      signal: 'project',
      sources: [
        { name: 'Grundriss_EG.pdf', detail: 'Seite 2' },
        { name: 'Schnitt_A-A.pdf', detail: 'Seite 1' },
      ],
    },
    {
      key: 'office',
      label: 'Büroablage',
      hitCount: 1,
      signal: 'office',
      sources: [{ name: 'Brandschutzkonzept_2023.pdf', detail: 'Referenzprojekt' }],
    },
  ],
}

const denseCommon = {
  ...defaultCommon,
  steps: [denseStep],
}

const retrievalStep = (index: number, query: string, reason: string): StoredThinkingStep => ({
  id: `status:retrieval:${index}`,
  userMessageId: 'msg-1',
  kind: 'retrieval',
  round: index,
  turnEvent: {
    key: 'status.retrieval.withQuery',
    values: { corpus: 'knowledge', query },
    tools: ['knowledge_search'],
    reason,
  },
  isComplete: true,
  timestamp: '2024-01-15T14:30:00Z',
})

const mergedHits = (
  rounds: ReadonlyArray<
    ReadonlyArray<{ name: string; detail: string; lane: 'law' | 'project' | 'office' }>
  >
): StoredThinkingStep => ({
  id: 'kb-spine',
  userMessageId: 'msg-1',
  kind: 'sources',
  tool: 'knowledge_search',
  isComplete: true,
  timestamp: '2024-01-15T14:30:02Z',
  traceLanes: rounds.flatMap((hits, round) =>
    (['law', 'project', 'office'] as const).flatMap((signal) => {
      const laneHits = hits.filter((hit) => hit.lane === signal)
      if (laneHits.length === 0) return []
      return [
        {
          key: signal === 'law' ? 'building_law_oib' : signal === 'project' ? 'project' : 'office',
          label:
            signal === 'law'
              ? 'OIB-Richtlinie'
              : signal === 'project'
                ? 'Projektwissen'
                : 'Büroablage',
          hitCount: laneHits.length,
          signal,
          sources: laneHits.map((hit) => ({ name: hit.name, detail: hit.detail, round })),
        },
      ]
    })
  ),
})

const SPINE_ROUNDS = [
  {
    query: 'Fluchtweglänge GK4',
    reason: 'Ich brauche zuerst die Grundregel für Fluchtweglängen in der Gebäudeklasse 4.',
    hits: [
      { name: 'OIB-RL_2_Brandschutz.pdf', detail: 'Pkt. 3.2', lane: 'law' as const },
      { name: 'Bauordnung für Wien', detail: '§ 108', lane: 'law' as const },
    ],
  },
  {
    query: 'Treppenraum Entrauchung',
    reason:
      'Die Grundregel steht — offen ist, ob der nördliche Treppenraum als Sicherheitstreppenhaus ausgeführt ist.',
    hits: [
      { name: 'Brandschutzkonzept.pdf', detail: 'Seite 4', lane: 'project' as const },
      { name: 'Grundriss_EG.pdf', detail: 'Seite 2', lane: 'project' as const },
      { name: 'Schnitt_A-A.pdf', detail: 'Seite 1', lane: 'project' as const },
    ],
  },
  {
    query: 'Referenzprojekt Sicherheitstreppenhaus RWA',
    reason:
      'Der Plan zeigt eine RWA im Treppenraum; wie das Büro das zuletzt nachgewiesen hat, steht in der Büroablage.',
    hits: [
      { name: 'Brandschutzkonzept_2023.pdf', detail: 'Referenzprojekt', lane: 'office' as const },
    ],
  },
]

const spineCommon = (roundCount: number) => ({
  ...defaultCommon,
  steps: [
    ...SPINE_ROUNDS.slice(0, roundCount).map((round, i) =>
      retrievalStep(i, round.query, round.reason)
    ),
    mergedHits(SPINE_ROUNDS.slice(0, roundCount).map((round) => round.hits)),
  ],
  citations: undefined,
  userQuestion:
    'Reichen die beiden Rettungswege im Regelgeschoss, wenn der nördliche Treppenraum kein Sicherheitstreppenhaus ist?',
})

const branchesCommon = {
  steps: [step],
  isThinking: false as const,
  defaultOpen: true,
  userQuestion:
    'Für ein sechsgeschossiges Bürogebäude der Gebäudeklasse 5 in Wien mit einer Bruttogeschossfläche von 1.200 m² pro Ebene: Wie viele bauliche Rettungswege sind nach OIB-Richtlinie 2 erforderlich, und welche Anforderungen gelten für die maximale Fluchtweglänge sowie die Ausbildung der Treppenhäuser?',
  enabledDataSources: ['OIB-Korpus', 'RIS', 'Projektdokumente'],
  escalationReason: 'shallow→deep',
}

const liveCommon = {
  steps: [
    { ...step, id: 'kb' },
    {
      id: 'tool:web',
      userMessageId: 'msg-1',
      kind: 'tool' as const,
      tool: 'web_search_tool',
      isComplete: false,
      timestamp: '2024-01-15T14:30:05Z',
    },
  ],
  isThinking: true as const,
  defaultOpen: true,
  userQuestion: defaultCommon.userQuestion,
  enabledDataSources: defaultCommon.enabledDataSources,
}

const workCommon = {
  ...defaultCommon,
  steps: foldScene(mockupScene()),
  citations: mockupCitations(),
  messageFiles: [],
  userQuestion: MOCKUP_QUESTION,
}
const workLiveCommon = {
  ...workCommon,
  steps: foldScene(mockupLiveScene()),
  citations: undefined,
  answerConfidence: undefined,
  isThinking: true as const,
}
const foldedCommon = { ...workCommon, defaultOpen: false }
const noResearchCommon = {
  ...defaultCommon,
  steps: [],
  citations: undefined,
  answerConfidence: 'medium' as const,
  messageFiles: [],
  userQuestion: 'Was ist der Unterschied zwischen Brandabschnitt und Brandwand?',
}
const failedCommon = {
  ...workCommon,
  steps: foldScene(failedCallScene()),
  citations: failedCallCitations(),
  userQuestion: 'Wie viele Stellplätze braucht die Tiefgarage nach dem Wiener Garagengesetz?',
}
const singleReadCommon = {
  ...workCommon,
  steps: foldScene(singleReadScene()),
  citations: singleReadCitations(),
  userQuestion:
    'Welche Feuerwiderstandsklasse nennt das Brandschutzkonzept für die Decke über der Garage?',
}
const filesystemCommon = {
  ...workCommon,
  steps: foldScene(filesystemScene()),
  citations: filesystemCitations(),
  userQuestion:
    'Wo stehen in der Einreichung die Brandabschnitte, und was sagt die Baubeschreibung dazu?',
}
const filesystemEdgesCommon = {
  ...workCommon,
  steps: foldScene(filesystemEdgesScene()),
  citations: undefined,
  answerConfidence: 'low' as const,
  userQuestion: 'Ist irgendwo eine Sprinkleranlage vorgesehen?',
}
const manyCallsCommon = {
  ...workCommon,
  steps: foldScene(manyCallsScene()),
  citations: undefined,
  userQuestion: 'Prüf bitte alle Pläne auf die Brandabschnitte der Garage.',
}

const storedCommon = ({ question, answer }: StoredAnswer) => {
  const message = mapServerMessageToChatMessage(answer)
  return {
    steps: [],
    isThinking: false as const,
    defaultOpen: false,
    userQuestion: question,
    answerConfidence: message?.answerConfidence,
    citations: message?.citations,
    confidenceCheck: message?.confidenceCheck,
    answerText: message?.content,
    answerId: message?.id,
    retrievalLedger: message?.retrievalLedger,
  }
}

export default function DerivationPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [variant, setVariant] = useState<string | null>(null)
  useEffect(() => {
    setVariant(new URLSearchParams(window.location.search).get('variant'))
  }, [])

  const narrow = variant === 'phone' || variant === 'fs' || variant === 'fs-edges'
  const common =
    variant === 'work' || variant === 'phone'
      ? workCommon
      : variant === 'fs'
        ? filesystemCommon
        : variant === 'fs-edges'
          ? filesystemEdgesCommon
          : variant === 'folded'
            ? foldedCommon
            : variant === 'no-research'
              ? noResearchCommon
              : variant === 'unbacked'
                ? storedCommon(UNBACKED)
                : variant === 'asked-back'
                  ? storedCommon(ASKED_BACK)
                  : variant === 'cited-question'
                    ? storedCommon(CITED_QUESTION)
              : variant === 'failed'
                ? failedCommon
                : variant === 'single-read'
                  ? singleReadCommon
                  : variant === 'many-calls'
                    ? manyCallsCommon
                    : variant === 'work'
                      ? workCommon
                      : variant === 'work-live'
                        ? workLiveCommon
                        : variant === 'branches'
                          ? branchesCommon
                          : variant === 'live'
                            ? liveCommon
                            : variant === 'dense'
                              ? denseCommon
                              : variant === 'spine'
                                ? spineCommon(2)
                                : variant === 'spine-folded'
                                  ? spineCommon(3)
                                  : defaultCommon
  const label =
    variant === 'fs'
      ? "/dev/derivation?variant=fs — ls, glob, grep and read_file over the office's documents"
      : variant === 'fs-edges'
        ? '/dev/derivation?variant=fs-edges — no hit, incomplete, not there, guessed, the places'
        : variant === 'phone'
          ? '/dev/derivation?variant=phone — the work turn at phone widths'
          : variant === 'folded'
            ? '/dev/derivation?variant=folded — panel closed: counts and the one warning'
            : variant === 'no-research'
              ? '/dev/derivation?variant=no-research — answered without research'
              : variant === 'unbacked'
                ? '/dev/derivation?variant=unbacked — stored answer, two statements unbacked'
                : variant === 'asked-back'
                  ? '/dev/derivation?variant=asked-back — stored answer that asks for the site'
                  : variant === 'cited-question'
                    ? '/dev/derivation?variant=cited-question — cited answer closing with a question'
              : variant === 'failed'
                ? '/dev/derivation?variant=failed — a failed RIS call'
                : variant === 'single-read'
                  ? '/dev/derivation?variant=single-read — one call, no graph'
                  : variant === 'many-calls'
                    ? '/dev/derivation?variant=many-calls — ×7, worst first, +N weitere'
                    : variant === 'work'
                      ? '/dev/derivation?variant=work — the 2026-10 Herleitung: rows, linked cards, Grundlagen'
                      : variant === 'work-live'
                        ? '/dev/derivation?variant=work-live — work list mid-round, running rows'
                        : variant === 'branches'
                          ? '/dev/derivation?variant=branches — long question, sources without findings'
                          : variant === 'live'
                            ? '/dev/derivation?variant=live — mid-stream turn (live status + chips)'
                            : variant === 'dense'
                              ? '/dev/derivation?variant=dense — 9 sources, packed into stacked columns'
                              : variant === 'spine'
                                ? '/dev/derivation?variant=spine — two retrieval rounds, both layers open'
                                : variant === 'spine-folded'
                                  ? '/dev/derivation?variant=spine-folded — three rounds, older layers folded'
                                  : '/dev/derivation — reasoning graph (desktop + mobile)'

  return (
    <main className="bg-background min-h-dvh px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <h1 className="text-muted-foreground font-mono text-xs" data-testid="derivation-preview">
          {label}
        </h1>
        {/* Same box the real thread gives the Herleitung (ChatArea's
            assistant-side spine) — the preview must not be wider than
            production, or the fan-out looks like it fits when it doesn't. */}
        {variant !== 'phone' && (
          <div className="w-[680px] max-w-full">
            <ChatThinking key={variant ?? 'default'} {...common} />
          </div>
        )}
        <div>
          <div className="text-muted-foreground mb-2 font-mono text-xs">↓ mobile width (380px)</div>
          <div className="w-[380px] max-w-full">
            <ChatThinking key={variant ?? 'default'} {...common} />
          </div>
        </div>
        {narrow && (
          <div>
            <div className="text-muted-foreground mb-2 font-mono text-xs">
              ↓ small phone (320px)
            </div>
            <div className="w-[320px] max-w-full">
              <ChatThinking key={variant ?? 'default'} {...common} />
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
