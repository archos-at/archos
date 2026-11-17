'use client'

import { useEffect, type FC, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AgentResponse } from '@/features/chat/components/AgentResponse'
import { CitationPeek } from '@/features/chat/components/CitationPeek'
import { buildCitationModel } from '@/features/chat/lib/citations'
import type { CitationSource } from '@/features/chat/types'

const at = new Date('2026-07-28T14:30:00')
const OIB = 'oib-rl_2.1_ausgabe_mai_2023.pdf'

const locus = (page: number, number: number, snippet?: string): CitationSource => ({
  id: `oib-${page}`,
  content: snippet ? `[KB] ${OIB}, p.${page}\n${snippet}` : `[KB] ${OIB}, p.${page}`,
  citationKey: `${OIB}, p.${page}`,
  documentId: `doc:oib_knowledge:${OIB}`,
  fileName: OIB,
  collection: 'oib_knowledge',
  title: 'OIB-Richtlinie 2.1, Ausgabe Mai 2023',
  origin: 'kb',
  kind: 'building_law',
  lane: 'building_law_oib',
  laneLabel: 'OIB-Richtlinie',
  sourceType: 'knowledge_layer',
  page,
  number,
  isCited: true,
  timestamp: at,
})

const citations: CitationSource[] = [
  locus(
    5,
    1,
    'Garagen mit mehr als 250 m² Nutzfläche sind mit einer mechanischen Entlüftung auszustatten.'
  ),
  locus(12, 2, 'Der zweite Fluchtweg darf über eine Außentreppe geführt werden.'),
  locus(18, 3),
  {
    id: 'ris',
    url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006',
    content: '[RIS] Bauordnung für Wien § 108',
    title: 'Bauordnung für Wien § 108 — Fluchtwege',
    origin: 'ris',
    kind: 'building_law',
    lane: 'building_law_state',
    laneLabel: 'Landesrecht',
    bindingNote: 'Macht die OIB-Richtlinien in Wien verbindlich (WBTV 2020).',
    number: 4,
    isCited: true,
    timestamp: at,
  },
]

const answer = [
  'Für eine Garage dieser Größe sind zwei Fluchtwege erforderlich [1]. Der zweite',
  'darf als Außentreppe ausgeführt werden [2], sofern die Rauchableitung den',
  'Anforderungen der Richtlinie entspricht [3]. Beide Anforderungen stehen in',
  'derselben Richtlinie [2][3]. In Wien ist diese Richtlinie über die Bauordnung',
  'verbindlich gestellt [4].',
  '',
  '## Quellen',
  `- [1] [KB] ${OIB}, p.5`,
  `- [2] [KB] ${OIB}, p.12`,
  `- [3] [KB] ${OIB}, p.18`,
  '- [4] [RIS] Bauordnung für Wien § 108 — https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006',
].join('\n')

const olderRevisionRef = () => {
  const fileName = 'EG_Grundriss_Index_B.pdf'
  const [document] = buildCitationModel({
    citations: [
      {
        id: 'older-revision',
        content: `[KB] ${fileName}, p.1`,
        citationKey: `${fileName}, p.1`,
        fileName,
        collection: 'proj_1',
        title: 'EG Grundriss, Index B',
        origin: 'kb',
        kind: 'project',
        shelf: 'project',
        page: 1,
        number: 1,
        isCited: true,
        timestamp: at,
      },
    ],
  })
  return document ? { document, locus: document.loci[0] } : null
}

const Block: FC<{ title: string; note: string; children: ReactNode }> = ({
  title,
  note,
  children,
}) => (
  <section className="flex flex-col gap-2">
    <div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="max-w-2xl text-xs text-muted-foreground">{note}</p>
    </div>
    {children}
  </section>
)

const OpenOnLoad: FC = () => {
  const params = useSearchParams()
  const which = params?.get('open')

  useEffect(() => {
    if (!which) return
    const timers: number[] = []

    const press = (selector: string, then?: () => void): void => {
      let attempts = 0
      const tick = (): void => {
        const target = document.querySelector<HTMLButtonElement>(selector)
        if (target) {
          target.focus()
          target.click()
          then?.()
          return
        }
        if (attempts++ > 60) return
        timers.push(window.setTimeout(tick, 50))
      }
      tick()
    }

    press('[data-citation-marker]', () =>
      which === 'dialog' ? press('[data-citation-open]') : undefined
    )

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [which])

  return null
}

const CorpusListing: FC = () => {
  useEffect(() => {
    const real = window.fetch
    window.fetch = (input, init) =>
      String(input) === '/api/knowledge-base'
        ? Promise.resolve(Response.json({ files: [{ fileName: OIB, state: 'ingested' }] }))
        : real(input, init)
    return () => {
      window.fetch = real
    }
  }, [])
  return null
}

export default function CitationInteractionPreview() {
  return (
    <div
      data-testid="citation-interaction-preview"
      className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8"
    >
      <CorpusListing />
      <OpenOnLoad />
      <Block
        title="Inline markers are citations"
        note="Each [N] is tinted by the provenance family of the source it names — three OIB passages and one binding legal source, distinguishable mid-sentence. Clicking one previews the document, its authority, its page and the passage itself, and marks the chip it belongs to. A claim carried by two sources is written [2][3] and renders as two pills, not as text."
      >
        <AgentResponse
          content={answer}
          messageId="preview-1"
          citations={citations}
          routingDecision="deep"
          answerConfidence="high"
        />
      </Block>

      <Block
        title="A citation of an older Fassung"
        note="When the cited document is a Fassung a person has since replaced, the peek adds one muted line — ‚Ältere Fassung — aktuell: …‘ — and the name opens the current Fassung beside the conversation. The citation itself stays as it was: an older Fassung is read on request."
      >
        <div className="w-80 rounded-lg border bg-popover p-3">
          {(() => {
            const ref = olderRevisionRef()
            return ref ? (
              <CitationPeek
                citation={ref}
                snippet="Die Wand in Achse 3 liegt 12 cm weiter westlich."
                supersededBy={{ id: 'doc-c', filename: 'EG_Grundriss_Index_C_2026-08-14.pdf' }}
              />
            ) : null
          })()}
        </div>
      </Block>

      <Block
        title="The same answer, inline variant"
        note="The compact bubble used inside a running thread. Same markers, same chips, same behaviour — a citation must not depend on which shell renders it."
      >
        <AgentResponse
          content={answer}
          messageId="preview-2"
          citations={citations}
          routingDecision="deep"
          variant="inline"
        />
      </Block>
    </div>
  )
}
