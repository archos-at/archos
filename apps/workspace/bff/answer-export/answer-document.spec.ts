/**
 * @vitest-environment node
 */

import { discriminatedOptions } from '@/lib/api/zod-union'
import { describe, expect, it } from 'vitest'
import { translatorFor } from '@/i18n/namespace'
import { answerExportCopy } from '@/i18n/namespaces/answer-export'
import type { DocBlock } from './blocks'
import { buildAnswerDocument, EXPORTED_CAPPED_REASONS, type AnswerDocumentInput } from './answer-document'
import { CARD_EXPORT, isCheck, SKIPPED_FIELDS, skippedNested } from './cards'
import { answerCardSchema } from '@/shared/cards/schemas'
import { previewFixtureFor } from '@/features/cards/preview-fixtures'
import { PRODUCT_NAME } from '@/lib/brand'

const german = translatorFor(answerExportCopy, 'de')
const english = translatorFor(answerExportCopy, 'en')

const CREATED_AT = new Date('2026-05-04T09:30:00Z')

const text = (blocks: DocBlock[]): string =>
  blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return block.text
        case 'paragraph':
          return block.runs.map((run) => run.text).join('')
        case 'bullets':
          return block.items.map((item) => item.map((run) => run.text).join('')).join('\n')
        case 'table':
          return [
            (block.head ?? []).join(' | '),
            ...block.rows.map((row) =>
              row.map((cell) => cell.map((run) => run.text).join('')).join(' | ')
            ),
          ]
            .filter(Boolean)
            .join('\n')
      }
    })
    .join('\n')

const input = (overrides: Partial<AnswerDocumentInput> = {}): AnswerDocumentInput => ({
  conversationTitle: 'Fluchtwege Bauteil B',
  projectName: 'Wohnhaus Seestadt',
  question: 'Wie lang darf der Fluchtweg in GK 4 sein?',
  answer: 'Die Gehweglänge darf **40 m** nicht überschreiten [1].',
  createdAt: CREATED_AT,
  ...overrides,
})

const storedCitations = {
  v: 1,
  sources: [
    {
      citation_key: 'OIB-RL 2, Pkt. 5.1.1',
      title: 'OIB-Richtlinie 2 — Brandschutz',
      page: 18,
      number: 1,
      url: 'https://www.oib.or.at/rl2',
      content: 'Die Gehweglänge darf 40 m nicht überschreiten.',
    },
    { citation_key: 'OIB-RL 2, Pkt. 5.1.1', page: 19, number: 1 },
    { title: 'ÖNORM B 1600', content: 'Barrierefreies Bauen' },
  ],
}

describe('the document’s chrome', () => {
  it('takes every heading from the dictionary, in the reader’s language', () => {
    const output = text(buildAnswerDocument(input(), german, 'de'))

    expect(output).toContain('Frage')
    expect(output).toContain('Antwort')
    expect(output).toContain('Projekt: Wohnhaus Seestadt')
    expect(output).toContain('Erstellt am: 4. Mai 2026')

    const english_ = text(buildAnswerDocument(input(), english, 'en'))
    expect(english_).toContain('Question')
    expect(english_).toContain('Project: Wohnhaus Seestadt')
    expect(english_).toContain('Created on: May 4, 2026')
  })

  it('titles the document with the conversation, and dates it from the ANSWER', () => {
    const blocks = buildAnswerDocument(input(), german, 'de')

    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, text: 'Fluchtwege Bauteil B' })
    expect(text(blocks)).toContain('4. Mai 2026')
  })

  it('renders the answer’s markdown as document structure, not as notation', () => {
    const blocks = buildAnswerDocument(
      input({ answer: '## Ergebnis\n\n- Erster Punkt\n- Zweiter Punkt' }),
      german,
      'de'
    )

    expect(blocks).toContainEqual({ kind: 'heading', level: 3, text: 'Ergebnis' })
    expect(text(blocks)).toContain('Erster Punkt')
    expect(text(blocks)).not.toContain('## Ergebnis')
  })
})

describe('the marking on an unreviewed document', () => {
  it('is absent from an ordinary export', () => {
    const plain = buildAnswerDocument(input(), german, 'de')

    expect(plain).toEqual(buildAnswerDocument(input({ agentAuthored: false }), german, 'de'))
    expect(plain[0]).toEqual({ kind: 'heading', level: 1, text: 'Fluchtwege Bauteil B' })
    expect(text(plain)).not.toContain('KI-generiert')
  })

  it('opens the document, ahead of its own title', () => {
    const blocks = buildAnswerDocument(input({ agentAuthored: true }), german, 'de')

    expect(blocks[0]).toEqual({
      kind: 'table',
      rows: [
        [
          [
            { text: 'KI-generiert — nicht geprüft\n', bold: true },
            { text: answerExportCopy.messages.de.aiNotice.body },
          ],
        ],
      ],
    })
    expect(blocks[1]).toEqual({ kind: 'heading', level: 1, text: 'Fluchtwege Bauteil B' })
  })

  it('says what the document is and what it is not, in both locales', () => {
    expect(text(buildAnswerDocument(input({ agentAuthored: true }), german, 'de'))).toContain(
      `Dieses Dokument hat ${PRODUCT_NAME} erstellt; ein Mensch hat es nicht geprüft. Es ist ein Entwurf und kein Nachweis — prüfen Sie jede Angabe, bevor Sie das Dokument weitergeben oder einreichen.`
    )
    expect(text(buildAnswerDocument(input({ agentAuthored: true }), english, 'en'))).toContain(
      'AI-generated — not reviewed'
    )
    expect(text(buildAnswerDocument(input({ agentAuthored: true }), english, 'en'))).toContain(
      `${PRODUCT_NAME} wrote this document; no person has reviewed it. It is a draft, not proof of compliance — check every statement before you pass the document on or submit it.`
    )
  })

  it('marks a document that carries nothing else', () => {
    const blocks = buildAnswerDocument(
      { answer: '', createdAt: CREATED_AT, agentAuthored: true },
      german,
      'de'
    )

    expect(text(blocks)).toContain('KI-generiert — nicht geprüft')
  })
})

describe('citations', () => {
  it('renders the stored sources as a numbered reference list, not as raw markers', () => {
    const output = text(buildAnswerDocument(input({ citations: storedCitations }), german, 'de'))

    expect(output).toContain('Quellen')
    expect(output).toContain('[1] OIB-RL 2, Pkt. 5.1.1 — OIB-Richtlinie 2 — Brandschutz, S. 18')
    expect(output).toContain('https://www.oib.or.at/rl2')
    expect(output).toContain('40 m nicht überschreiten [1]')
  })

  it('lists a source once even when several passages of it were retrieved', () => {
    const output = text(buildAnswerDocument(input({ citations: storedCitations }), german, 'de'))

    expect(output.match(/\[1\] OIB-RL 2/g)).toHaveLength(1)
    expect(output).not.toContain('ÖNORM B 1600')
  })

  it('keeps the numbers the prose used rather than renumbering the list', () => {
    const citations = {
      v: 1,
      sources: [
        { title: 'Zweite Quelle', number: 2 },
        { title: 'Dritte Quelle', number: 3 },
      ],
    }
    const output = text(
      buildAnswerDocument(input({ answer: 'Siehe [3] und [2].', citations }), german, 'de')
    )

    expect(output).toContain('[2] Zweite Quelle')
    expect(output).toContain('[3] Dritte Quelle')
    expect(output).not.toContain('[1]')
  })

  it('falls back to the sources the answer wrote into its own prose, and states them once', () => {
    const answer =
      'Die Gehweglänge darf 40 m nicht überschreiten [1].\n\n' +
      '## Quellen\n\n1. OIB-Richtlinie 2, Ausgabe 2023, S. 18\n'
    const output = text(buildAnswerDocument(input({ answer }), german, 'de'))

    expect(output).toContain('[1] OIB-Richtlinie 2, Ausgabe 2023, S. 18')
    expect(output.match(/OIB-Richtlinie 2, Ausgabe 2023, S\. 18/g)).toHaveLength(1)
  })

  it('names an untitled source rather than leaving a blank line in the list', () => {
    const output = text(
      buildAnswerDocument(
        input({ citations: { v: 1, sources: [{ number: 1, content: 'irgendein Text' }] } }),
        german,
        'de'
      )
    )

    expect(output).toContain('[1] Quelle ohne Titel')
  })
})

describe('fields the stored answer does not have', () => {
  it('omits the project, the confidence and the sources rather than writing placeholders', () => {
    const output = text(
      buildAnswerDocument(
        input({ projectName: null, question: null, citations: undefined, confidence: null }),
        german,
        'de'
      )
    )

    expect(output).not.toContain('Projekt')
    expect(output).not.toContain('Frage')
    expect(output).not.toContain('Quellen')
    expect(output).not.toContain('Verlässlichkeit')
    expect(output).not.toContain('—')
    expect(output).not.toContain('n/a')
  })

  it('treats a whitespace-only project name as no project at all', () => {
    const output = text(buildAnswerDocument(input({ projectName: '   ' }), german, 'de'))

    expect(output).not.toContain('Projekt')
  })

  it('falls back to the dictionary title when the conversation was never named', () => {
    const blocks = buildAnswerDocument(input({ conversationTitle: null }), german, 'de')

    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, text: 'Antwort' })
  })

  it('drops the answer section entirely when the stored prose is empty', () => {
    const output = text(buildAnswerDocument(input({ answer: '   ' }), german, 'de'))

    expect(output).not.toContain('Antwort\n')
    expect(output).toContain('Frage')
  })

  it('carries the confidence and its reason when the answer stored them', () => {
    const output = text(
      buildAnswerDocument(
        input({
          confidence: {
            level: 'medium',
            reason: 'Die Quelle nennt die Länge, nicht aber die Ausnahme.',
            cappedReason: 'quote_unverified',
          },
        }),
        german,
        'de'
      )
    )

    expect(output).toContain('Verlässlichkeit: mittel')
    expect(output).toContain('Begründung des Assistenten: Die Quelle nennt die Länge')
    expect(output).toContain('nicht wortgleich gegen die Quelle prüfbar')
  })

  it.each([
    ['ungrounded', 'nicht durch Quellen belegt'],
    ['quote_unverified', 'nicht wortgleich gegen die Quelle prüfbar'],
    ['law_unsettled', 'verbindliche Fassung des Baurechts steht für diesen Standort noch nicht geprüft fest'],
  ] as const)('explains the %s cap in its own words', (cappedReason, sentence) => {
    const output = text(
      buildAnswerDocument(input({ confidence: { level: 'medium', cappedReason } }), german, 'de')
    )
    expect(output).toContain(sentence)
    expect(EXPORTED_CAPPED_REASONS).toContain(cappedReason)
  })

  it('names every cap it can export', () => {
    expect([...EXPORTED_CAPPED_REASONS].sort()).toEqual(['law_unsettled', 'open_point', 'quote_unverified', 'ungrounded'])
  })
})

describe('cards', () => {
  const dimensions = {
    type: 'dimension_diagram',
    title: 'Türbreiten Stiegenhaus',
    shape: 'door',
    dimensions: [
      {
        label: 'lichte Durchgangsbreite',
        value: 90,
        required: 80,
        unit: 'cm',
        comparator: '>=',
        status: 'pass',
      },
      { label: 'Schwellenhöhe', value: null, unit: 'cm', status: 'needs_input' },
    ],
    reference: { document: 'OIB-Richtlinie 4', edition: 'Ausgabe Mai 2023' },
    note: null,
  }

  it('renders a card’s checks as a titled table with translated verdicts', () => {
    const blocks = buildAnswerDocument(input({ cards: [dimensions] }), german, 'de')
    const output = text(blocks)

    expect(output).toContain('Befunde')
    expect(output).toContain('Türbreiten Stiegenhaus')
    expect(output).toContain('lichte Durchgangsbreite | 90 | 80 | cm | mindestens | Anforderung erfüllt')
    expect(output).toContain('Angabe erforderlich')
    expect(output).toContain('OIB-Richtlinie 4, Ausgabe Mai 2023')
    expect(output).not.toContain('{')
    expect(blocks.some((block) => block.kind === 'table')).toBe(true)
  })

  it('renders a measured value with the qualifiers that say who is claiming it', () => {
    const stair = {
      type: 'stair_diagram',
      title: 'Treppenlauf',
      riser_count: 17,
      riser_height: {
        label: 'Steigung',
        value: 18.2,
        required: 18,
        unit: 'cm',
        comparator: '<=',
        status: 'fail',
        provenance: 'computed',
        tolerance: 0.5,
      },
      reference: { document: 'OIB-Richtlinie 4' },
    }
    const output = text(buildAnswerDocument(input({ cards: [stair] }), german, 'de'))

    expect(output).toContain('Position | Ist | Soll | Beurteilung')
    expect(output).toContain(
      'Steigung | 18.2 ±0.5 cm (gemessen) | <= 18 cm | Anforderung nicht erfüllt'
    )
  })

  it('states a live-data card instead of dropping it', () => {
    const output = text(
      buildAnswerDocument(
        input({ cards: [{ type: 'ifc_compliance', title: 'Anforderungen Brandschutz' }] }),
        german,
        'de'
      )
    )

    expect(output).toContain('Anforderungen Brandschutz')
    expect(output).toContain('liest das Modell des Projekts live')
  })

  it('exports a matrix’s rows, headed by the columns the card declares', () => {
    const output = text(
      buildAnswerDocument(
        input({
          cards: [
            {
              type: 'a_card_from_the_future',
              title: 'Mindestmaße barrierefreie Erschließung',
              columns: [
                { label: 'Bauteil', type: 'text' },
                { label: 'Mindestmaß', type: 'mass' },
                { label: 'Fundstelle', type: 'norm' },
              ],
              rows: [
                ['Türbreite', '80 cm', 'OIB 4, Pkt. 2.2'],
                ['Rampenneigung', '6 %', 'OIB 4, Pkt. 2.3'],
              ],
            },
          ],
        }),
        german,
        'de'
      )
    )

    expect(output).toContain('Bauteil | Mindestmaß | Fundstelle')
    expect(output).toContain('Türbreite | 80 cm | OIB 4, Pkt. 2.2')
    expect(output).toContain('Rampenneigung | 6 % | OIB 4, Pkt. 2.3')
    expect(output).not.toContain('Columns')
  })

  const schrittmass = (limit: Record<string, unknown>) => ({
    type: 'calculation',
    title: 'Schrittmaßregel',
    steps: [
      {
        label: 'Schrittmaß',
        operation: 'sum',
        operands: [
          { label: 'Steigung', value: 17.5, unit: 'cm', factor: 2 },
          { label: 'Auftritt', value: 24, unit: 'cm' },
        ],
        unit: 'cm',
      },
    ],
    limit,
  })

  it('names a limit as a limit, and its lower bound as a lower bound', () => {
    const range = text(
      buildAnswerDocument(
        input({ cards: [schrittmass({ comparator: 'between', value: 59, upper: 65 })] }),
        german,
        'de'
      )
    )

    expect(range).toContain('Untergrenze: 59')
    expect(range).toContain('Obergrenze: 65')
    expect(range).not.toContain('Ist: 59')

    const capped = text(
      buildAnswerDocument(
        input({ cards: [schrittmass({ comparator: '<=', value: 1.2 })] }),
        german,
        'de'
      )
    )

    expect(capped).toContain('Grenzwert: 1.2')
    expect(capped).not.toContain('Ist: 1.2')
  })

  it('prints a card’s closed vocabularies as words, not as wire values', () => {
    const output = text(
      buildAnswerDocument(
        input({
          cards: [
            { ...dimensions, shape: 'turning_circle' },
            {
              type: 'egress_diagram',
              title: 'Fluchtweg',
              segments: [{ label: 'Raum → Gang', length_m: 12, turn: 'straight' }],
              reference: { document: 'OIB-Richtlinie 2' },
            },
          ],
        }),
        german,
        'de'
      )
    )

    expect(output).toContain('Wendekreis')
    expect(output).toContain('geradeaus')

    for (const wire of ['turning_circle', 'straight']) {
      expect(output, `the wire value ${wire} reached the document`).not.toContain(wire)
    }
  })

  it('titles a card that has no title of its own from its type', () => {
    const output = text(
      buildAnswerDocument(
        input({ cards: [{ type: 'stair_diagram', riser_count: 17 }] }),
        german,
        'de'
      )
    )

    expect(output).toContain('Treppe')
  })
})

describe('the drawing this export cannot draw', () => {
  it('prints the placeholder for a drawing inside a composed tab (ADR-0065)', () => {
    const tab = {
      type: 'surface',
      components: [
        { id: 'root', component: 'Tabs', tabs: [{ title: 'Ablauf', child: 'a' }] },
        { id: 'a', component: 'Text', text: '```mermaid\nsequenceDiagram\n  BW->>BB: Einreichunterlagen\n```' },
      ],
    }
    const output = text(
      buildAnswerDocument(input({ answer: '', cards: [tab], diagramPlaceholder: `Als Grafik in ${PRODUCT_NAME}.` }), german, 'de')
    )
    expect(output).toContain(`Als Grafik in ${PRODUCT_NAME}.`)
    expect(output).not.toContain('BW->>BB')
  })
})

describe('cards that are the app talking, not the answer', () => {
  const delegation = {
    type: 'task_created',
    task_id: '00000000-0000-4000-8000-0000000000f1',
    kind: 'submission_check',
    title: 'Einreichcheck: Bauansuchen Haus A',
    goal: 'Mach den Einreichcheck für das Bauansuchen bis Freitag',
    due_at: null,
    conversation_id: null,
  }

  it('leaves a delegation notice out of the document entirely', () => {
    const output = text(buildAnswerDocument(input({ cards: [delegation] }), german, 'de'))

    expect(output).not.toContain('Einreichcheck: Bauansuchen Haus A')
    expect(output).not.toContain('Mach den Einreichcheck')
  })

  it('omits the findings section altogether when chrome was the only card', () => {
    const output = text(buildAnswerDocument(input({ cards: [delegation] }), german, 'de'))
    expect(output).not.toContain('Befunde')
  })

  it('does not report a proposal whose outcome it cannot know', () => {
    const output = text(
      buildAnswerDocument(
        input({
          cards: [
            {
              type: 'project_profile_patch',
              title: 'Projektkontext aktualisieren',
              rationale: 'Fluchtniveau über 22 m.',
              patch: [{ op: 'add', path: '/facts/fluchtniveau', value: '>22m' }],
            },
            {
              type: 'memory_proposal',
              title: 'Merken?',
              content: 'REI 90 durchgängig',
              kind: 'preference',
              confidence: 'high',
            },
          ],
        }),
        german,
        'de'
      )
    )

    expect(output).not.toContain('Projektkontext aktualisieren')
    expect(output).not.toContain('/facts/fluchtniveau')
    expect(output).not.toContain('Merken?')
  })

  it('drops the model picker, which on paper is a question about which model', () => {
    const output = text(
      buildAnswerDocument(
        input({
          cards: [{ type: 'ifc_model_picker', title: 'Welches Modell möchten Sie öffnen?' }],
        }),
        german,
        'de'
      )
    )

    expect(output).not.toContain('Welches Modell')
  })

  it('still exports a card of a type this build has never heard of', () => {
    const output = text(
      buildAnswerDocument(
        input({
          cards: [{ type: 'a_card_from_the_future', title: 'Neue Karte', note: 'Ein Befund.' }],
        }),
        german,
        'de'
      )
    )

    expect(output).toContain('Neue Karte')
    expect(output).toContain('Ein Befund.')
  })
})

describe('every string in the document comes from a dictionary', () => {
  const authoredCards: Record<string, unknown>[] = [
    {
      type: 'project_profile_patch',
      title: 'Projektkontext',
      rationale: 'Neu gelernt.',
      patch: [{ op: 'add', path: '/facts/gk', value: 'GK4' }],
      preview: [{ label: 'GK', before: '-', after: 'GK4' }],
    },
    {
      type: 'memory_proposal',
      title: 'Merken?',
      content: 'Fluchtniveau 9,8 m',
      kind: 'derived_fact',
      confidence: 'high',
    },
    {
      type: 'building_section',
      title: 'Schnitt',
      storeys: [{ label: 'EG', height_m: 3, below_grade: false }],
      markers: [{ label: 'Fluchtniveau', height_m: 9.8, kind: 'escape_level' }],
      reference: { document: 'OIB 2' },
    },
    {
      type: 'stair_diagram',
      title: 'Treppe',
      riser_count: 17,
      riser_height: { label: 'Steigung', value: 18, unit: 'cm', status: 'pass' },
      tread_depth: { label: 'Auftritt', value: 28, unit: 'cm', status: 'pass' },
      width: { label: 'Breite', value: 100, unit: 'cm', status: 'pass' },
      comfort_note: 'Schrittmaß erfüllt',
      reference: { document: 'OIB 4' },
    },
    {
      type: 'dimension_diagram',
      title: 'Rampe',
      shape: 'ramp',
      dimensions: [{ label: 'Neigung', value: 6, required: 10, unit: '%', status: 'pass' }],
      reference: { document: 'OIB 4' },
    },
    {
      type: 'setback_plan',
      title: 'Abstände',
      parcel_width_m: 20,
      parcel_depth_m: 30,
      building_width_m: 10,
      building_depth_m: 12,
      sides: [{ side: 'front', required_m: 3, actual_m: 4, status: 'pass' }],
      reference: { document: 'Bauordnung' },
    },
    {
      type: 'egress_diagram',
      title: 'Fluchtweg',
      start_label: 'ungünstigster Punkt',
      exit_label: 'Treppenhaus',
      segments: [{ label: 'Raum → Gang', length_m: 12, turn: 'left' }],
      total_length: { label: 'Gesamt', value: 38, required: 40, unit: 'm', status: 'pass' },
      reference: { document: 'OIB 2' },
    },
    {
      type: 'daylight_incidence',
      title: 'Belichtung',
      room_floor_area_m2: 24,
      window_sill_height_m: 0.9,
      window_head_height_m: 2.4,
      glass_area: { label: 'Lichteintritt', value: 3, required: 2.4, unit: 'm²', status: 'pass' },
      obstruction: { label: 'Nachbargebäude', distance_m: 8 },
      reference: { document: 'OIB 3' },
    },
    {
      type: 'guardrail_check',
      title: 'Geländer',
      context: 'balcony',
      fall_height: { label: 'Absturzhöhe', value: 8, unit: 'm', status: 'pass' },
      rail_height: { label: 'Höhe', value: 100, required: 100, unit: 'cm', status: 'pass' },
      max_opening: { label: 'Öffnung', value: 11, required: 12, unit: 'cm', status: 'pass' },
      bottom_gap: { label: 'Bodenabstand', value: 3, unit: 'cm', status: 'pass' },
      has_horizontal_elements_in_climb_zone: false,
      reference: { document: 'OIB 4' },
    },
    {
      type: 'fire_access_plan',
      title: 'Feuerwehrzufahrt',
      building_class: 'GK 4',
      parcel_width_m: 20,
      parcel_depth_m: 30,
      building_width_m: 10,
      building_depth_m: 12,
      route_width: { label: 'Zufahrt', value: 3.5, required: 3, unit: 'm', status: 'pass' },
      gate_clearance_height: {
        label: 'Durchfahrt',
        value: 4,
        required: 3.5,
        unit: 'm',
        status: 'pass',
      },
      staging_area: {
        width: { label: 'Aufstellfläche Breite', value: 5, required: 5, unit: 'm', status: 'pass' },
        length: {
          label: 'Aufstellfläche Länge',
          value: 12,
          required: 10,
          unit: 'm',
          status: 'pass',
        },
      },
      walk_distance_to_entrance: {
        label: 'Weg',
        value: 60,
        required: 80,
        unit: 'm',
        status: 'pass',
      },
      reference: { document: 'TRVB F 134' },
    },
    {
      type: 'document_grid',
      title: 'Dokumente',
      query: 'Fluchtwege',
      documents: [
        { file_name: 'einreichplan.pdf', summary: 'Einreichplan', snippet: 'Fluchtweg', page: 3 },
      ],
    },
    { type: 'ifc_viewer', title: 'Modell' },
    { type: 'ifc_compliance', title: 'Prüfbuch' },
    { type: 'ifc_schedule', title: 'Raumbuch' },
    { type: 'ifc_element', title: 'Wand', global_id: '0abc' },
    { type: 'ifc_diff', title: 'Änderungen', base_model_file: 'a.ifc' },
    { type: 'ifc_model_picker', title: 'Modelle des Projekts' },
  ]

  const kindOf = (card: Record<string, unknown>) =>
    CARD_EXPORT[card.type as keyof typeof CARD_EXPORT]

  const authored = new Map(authoredCards.map((card) => [card.type as string, card]))
  const everyCardType: Record<string, unknown>[] = [...discriminatedOptions(answerCardSchema).keys()]
    .filter((type): type is string => typeof type === 'string')
    .map(
      (type) =>
        authored.get(type) ?? (previewFixtureFor(type) as Record<string, unknown> | undefined)
    )
    .filter((card): card is Record<string, unknown> => card !== undefined)

  it('covers every card type in the union', () => {
    const covered = new Set(everyCardType.map((card) => card.type))
    const uncovered = [...discriminatedOptions(answerCardSchema).keys()].filter((type) => !covered.has(type))
    expect(
      uncovered,
      'no authored body and no preview fixture — add one, or the export is untested for this type'
    ).toEqual([])
  })

  it.each([
    ['de', german],
    ['en', english],
  ])('resolves every key in %s', (locale, t) => {
    const output = text(
      buildAnswerDocument(
        input({
          cards: everyCardType,
          citations: storedCitations,
          confidence: { level: 'low', reason: 'Wenig Belege.', cappedReason: 'ungrounded' },
        }),
        t,
        locale as 'de' | 'en'
      )
    )

    const unresolved = output.match(/answerExport\.[\w.]+/g) ?? []
    expect(unresolved, `unresolved translation keys in the ${locale} document`).toEqual([])
  })

  const vocabularies = answerExportCopy.messages.de.values as Record<
    string,
    Record<string, string | undefined> | undefined
  >

  const payloadValues = (card: Record<string, unknown>): string[][] => {
    const expected: string[][] = []
    const walk = (path: string, name: string, value: unknown, direct: boolean): void => {
      if (value === null || value === undefined) return
      if (Array.isArray(value)) {
        for (const entry of value) walk(path, name, entry, false)
        return
      }
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        const namedByItsField = isCheck(record) && !direct
        for (const [key, entry] of Object.entries(record)) {
          if (skippedNested(path, key)) continue
          if (key === 'label' && namedByItsField) continue
          walk(`${path}.${key}`, key, entry, false)
        }
        return
      }
      if (typeof value === 'boolean') {
        expected.push([answerExportCopy.messages.de.boolean[value ? 'true' : 'false']])
        return
      }
      if (typeof value === 'number') {
        expected.push([String(value)])
        return
      }
      if (typeof value !== 'string' || !value.trim()) return
      const word = vocabularies[name]?.[value]
      expected.push(word ? [value, word] : [value])
    }
    for (const [name, value] of Object.entries(card)) {
      if (!SKIPPED_FIELDS.has(name)) walk(`${String(card.type)}.${name}`, name, value, true)
    }
    return expected
  }

  it('exports every card in the catalogue, so none is silently lost', () => {
    const withoutCards = text(buildAnswerDocument(input({ cards: [] }), german, 'de')).length
    const findings = everyCardType.filter((card) => kindOf(card) !== 'chrome')
    expect(findings.length).toBeGreaterThan(10)

    for (const card of findings) {
      const output = text(buildAnswerDocument(input({ cards: [card] }), german, 'de'))
      expect(output.length, `card ${card.type} added nothing to the document`).toBeGreaterThan(
        withoutCards
      )
      const heading = typeof card.title === 'string' ? card.title : ''
      if (heading) {
        expect(output, `card ${card.type} is missing from the document`).toContain(heading)
      }
    }
  })

  it('carries every value a card states, not just the card’s chrome', () => {
    const findings = everyCardType.filter((card) => kindOf(card) === 'content')
    let asserted = 0
    const lost: string[] = []

    for (const card of findings) {
      const output = text(buildAnswerDocument(input({ cards: [card] }), german, 'de'))
      for (const spellings of payloadValues(card)) {
        asserted += 1
        if (!spellings.some((spelling) => output.includes(spelling))) {
          lost.push(`${String(card.type)}: ${JSON.stringify(spellings[0])}`)
        }
      }
    }

    expect(
      lost.sort(),
      'these values are stated by a card and absent from the document it produced — ' +
        'the card emitted its chrome and dropped this part of its payload'
    ).toEqual([])
    expect(asserted).toBeGreaterThan(100)
  })

  it('drops every card classified as chrome, and only those', () => {
    const withoutCards = text(buildAnswerDocument(input({ cards: [] }), german, 'de'))

    const dropped = everyCardType
      .filter(
        (card) => text(buildAnswerDocument(input({ cards: [card] }), german, 'de')) === withoutCards
      )
      .map((card) => String(card.type))
    const chrome = everyCardType
      .filter((card) => kindOf(card) === 'chrome')
      .map((card) => String(card.type))

    expect(
      dropped.sort(),
      'the cards the document leaves out must be exactly the cards CARD_EXPORT calls chrome — ' +
        'anything else here is either a finding silently lost or chrome printed under „Befunde“'
    ).toEqual(chrome.sort())
    expect(chrome.length).toBeGreaterThan(0)
  })
})
