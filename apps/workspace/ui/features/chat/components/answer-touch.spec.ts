import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test-utils'
import { buildCitationModel, type CitationRef, type CitedDocument } from '../lib/citations'
import type { CitationSource } from '../types'
import { AnswerSourcesRow } from './AnswerSourcesRow'
import { CitationPeek } from './CitationPeek'
import { FindingsMatrix } from './FindingsMatrix'
import { PlanChecklist, type PlanShape } from './PlanChecklist'
import { RisDocumentDialog } from '@/features/knowledge/components/ris-document-dialog'

const controlsIn = (root: ParentNode): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('button, a'))

const coarse = (control: HTMLElement): boolean => control.className.includes('pointer-coarse:')

const plan: PlanShape = {
  title: 'Prüfplan Brandschutz',
  sections: ['Brandwand', 'Fluchtweg'],
  genre: 'checklist',
  depth: 'quick_check',
  basis: ['Bestandsplan'],
  excluded: [],
  documents: [],
}

const findings = {
  v: 1 as const,
  items: [
    {
      requirement: 'Feuerwiderstand tragender Bauteile',
      value: 'REI 60',
      status: 'met' as const,
      grounding: 'sourced' as const,
      reference: { document: 'Brandschutz-Richtlinie 2', section: 'Tabelle 1b', page: 12 },
      citations: [1],
      comment: 'Gilt für GK 4; im Kellergeschoß REI 90.',
    },
    { requirement: 'Zweiter Fluchtweg', status: 'open' as const, grounding: 'open' as const, citations: [] },
  ],
}

const manyDocuments: CitedDocument[] = Array.from({ length: 10 }, (_, index): CitedDocument => ({
  id: `doc-${index}`,
  title: `Richtlinie ${index + 1}`,
  kind: 'building_law',
  lane: 'building_law_oib',
  tint: 'oib',
  loci: [{ key: `l${index}`, page: index + 1, number: index + 1, isCited: true }],
}))

const citationWith = (overrides: Partial<CitationSource>): CitationRef => {
  const [document] = buildCitationModel({
    citations: [
      {
        id: 'c-1',
        content: '[KB] plan.pdf, p.4',
        timestamp: new Date('2026-10-01T10:00:00Z'),
        citationKey: 'plan.pdf, p.4',
        fileName: 'plan.pdf',
        kind: 'project',
        page: 4,
        isCited: true,
        snippet: '[DRAWING from page 4] Grundriss 1. OG.',
        ...overrides,
      },
    ],
  })
  return { document: document!, locus: document!.loci[0] }
}

const LAW_URL = 'https://example.test/law/1'

describe('hand-written controls in answer content', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PlanChecklist sizes every button and link for a finger', () => {
    const { container } = render(createElement(PlanChecklist, { plan, onChange: () => {} }))
    const controls = controlsIn(container)
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.filter((control) => !coarse(control))).toEqual([])
  })

  it('FindingsMatrix sizes every button and link for a finger', () => {
    const { container } = render(
      createElement(FindingsMatrix, { findings, anchorPrefix: 'src-', onCommission: async () => true })
    )
    const controls = controlsIn(container)
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.filter((control) => !coarse(control))).toEqual([])
  })

  it('CitationPeek sizes every button and link for a finger', () => {
    const { container } = render(
      createElement(CitationPeek, {
        citation: citationWith({}),
        snippet: 'x',
        onOpen: () => {},
        onDownload: () => {},
      })
    )
    const controls = controlsIn(container)
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.filter((control) => !coarse(control))).toEqual([])
  })

  it('AnswerSourcesRow sizes every button and link for a finger', () => {
    const { container } = render(createElement(AnswerSourcesRow, { documents: manyDocuments, anchorPrefix: 'src-' }))
    const controls = controlsIn(container)
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.filter((control) => !coarse(control))).toEqual([])
  })

  it('RisDocumentDialog sizes every button and link in the dialog for a finger', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ url: LAW_URL, title: 'Bauordnung', text: '§ 1', truncated: false }), { status: 200 })
      )
    )
    render(
      createElement(RisDocumentDialog, {
        open: true,
        onOpenChange: () => {},
        url: LAW_URL,
        title: 'Bauordnung',
      })
    )
    const controls = controlsIn(document.querySelector('[role="dialog"]') ?? document.body)
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.filter((control) => !coarse(control))).toEqual([])
  })

  it('the plan checklist removes a point and an Unterlage with a 44px control', () => {
    const { container } = render(createElement(PlanChecklist, { plan, onChange: () => {} }))
    const sized = controlsIn(container).filter((control) => control.className.includes('pointer-coarse:size-11'))
    expect(sized.length).toBeGreaterThanOrEqual(3)
  })
})
