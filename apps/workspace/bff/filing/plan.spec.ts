import { describe, expect, it } from 'vitest'
import type { FileOperationPayload } from '@/lib/proposals/types'
import { planFiling, type FilingPlanInput, type RecordedProposal } from './plan'
import type { FilingMove } from './types'

const move = (documentId: string, folder: string, extra: Partial<FilingMove> = {}): FilingMove => ({
  documentId,
  folder,
  reason: `${documentId} gehört nach ${folder}.`,
  newFolder: null,
  confidence: null,
  ...extra,
})

const DOCUMENTS = [
  { id: 'd1', filename: 'MA37_Bescheid.pdf' },
  { id: 'd2', filename: 'Fristerstreckung.pdf' },
  { id: 'd3', filename: 'EG.pdf' },
]

const input = (patch: Partial<FilingPlanInput> = {}): FilingPlanInput => ({
  basis: 'name',
  shelf: 'project',
  documents: DOCUMENTS,
  batch: DOCUMENTS,
  judged: true,
  moves: [],
  restrictedDocumentIds: new Set(),
  restrictedPaths: [],
  record: [],
  ...patch,
})

const recorded = (
  id: string,
  status: 'proposed' | 'dismissed',
  items: Array<[string, string]>,
  extra: Partial<RecordedProposal> & { basis?: FileOperationPayload['basis'] } = {}
): RecordedProposal => ({
  id,
  status,
  payload: {
    operation: 'move',
    operations: items.map(([document, target]) => ({ document, source: 'project', target_folder: target })),
    basis: extra.basis === undefined ? 'name' : extra.basis,
  },
  originConversationId: null,
  claimed: false,
  ...extra,
})

describe('planFiling', () => {
  it('makes one proposal per target folder, with no conversation to name and every reason kept', () => {
    const plan = planFiling(
      input({ moves: [move('d1', 'Bescheide'), move('d2', 'Korrespondenz'), move('d3', 'Bescheide')] })
    )
    expect(plan.withdraw).toEqual([])
    expect(plan.create).toHaveLength(2)
    const permitDecisions = plan.create.find((payload) => payload.operations[0].target_folder === 'Bescheide')
    expect(permitDecisions).toMatchObject({
      operation: 'move',
      basis: 'name',
      new_folder: null,
      operations: [
        { document: 'MA37_Bescheid.pdf', document_id: 'd1', source: 'project', target_folder: 'Bescheide', reason: 'd1 gehört nach Bescheide.' },
        { document: 'EG.pdf', document_id: 'd3', source: 'project', target_folder: 'Bescheide', reason: 'd3 gehört nach Bescheide.' },
      ],
    })
  })

  it('names the new folder a convention would create, and files the Bürobibliothek as buero', () => {
    const plan = planFiling(
      input({
        shelf: 'office_shelf',
        moves: [move('d2', 'Korrespondenz', { newFolder: { description: 'Briefe und Mails' } })],
      })
    )
    expect(plan.create).toEqual([
      {
        operation: 'move',
        operations: [
          {
            document: 'Fristerstreckung.pdf',
            document_id: 'd2',
            source: 'office',
            target_folder: 'Korrespondenz',
            reason: 'd2 gehört nach Korrespondenz.',
          },
        ],
        basis: 'name',
        new_folder: { path: 'Korrespondenz', description: 'Briefe und Mails' },
      },
    ])
  })

  it('splits a folder with more than eight files into proposals of eight', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `m${index}`, filename: `Bescheid ${index}.pdf` }))
    const plan = planFiling(input({ documents: many, batch: many, moves: many.map((document) => move(document.id, 'Bescheide')) }))
    expect(plan.create.map((payload) => payload.operations.length)).toEqual([8, 2])
  })

  it('never moves a document out of a restricted folder, nor into one or below it', () => {
    const plan = planFiling(
      input({
        moves: [move('d1', 'Bescheide'), move('d2', 'Honorare'), move('d3', 'Honorare/2026')],
        restrictedDocumentIds: new Set(['d1']),
        restrictedPaths: ['honorare'],
      })
    )
    expect(plan.create).toEqual([])
  })

  it('never proposes again what a person dismissed for that document and target, but may propose another target', () => {
    const plan = planFiling(
      input({
        moves: [move('d1', 'Bescheide'), move('d2', 'Korrespondenz')],
        record: [
          recorded('p-old', 'dismissed', [['ma37_bescheid.pdf', 'bescheide']]),
          recorded('p-old2', 'dismissed', [['Fristerstreckung.pdf', 'Bescheide']]),
        ],
      })
    )
    expect(plan.create.map((payload) => payload.operations.map((item) => item.document))).toEqual([['Fristerstreckung.pdf']])
  })

  it('does not stack a second open proposal on a document one already names, whoever made it', () => {
    const plan = planFiling(
      input({
        moves: [move('d1', 'Bescheide'), move('d2', 'Korrespondenz')],
        record: [
          recorded('p-chat', 'proposed', [['MA37_Bescheid.pdf', 'Einreichung']], { originConversationId: 'conv-1', basis: null }),
          recorded('p-name', 'proposed', [['Fristerstreckung.pdf', 'Bescheide']]),
        ],
      })
    )
    expect(plan.create).toEqual([])
    expect(plan.withdraw).toEqual([])
  })

  it('withdraws a name suggestion the content judgement files elsewhere, and proposes the sharper one', () => {
    const plan = planFiling(
      input({
        basis: 'content',
        moves: [move('d2', 'Korrespondenz')],
        record: [recorded('p-name', 'proposed', [['Fristerstreckung.pdf', 'Bescheide']])],
      })
    )
    expect(plan.withdraw).toEqual(['p-name'])
    expect(plan.create.map((payload) => payload.operations[0].target_folder)).toEqual(['Korrespondenz'])
  })

  it('withdraws a name suggestion the content judgement no longer supports, and keeps one it confirms', () => {
    const plan = planFiling(
      input({
        basis: 'content',
        moves: [move('d1', 'Bescheide')],
        record: [
          recorded('p-kept', 'proposed', [['MA37_Bescheid.pdf', 'Bescheide']]),
          recorded('p-gone', 'proposed', [['EG.pdf', 'Bescheide']]),
        ],
      })
    )
    expect(plan.withdraw).toEqual(['p-gone'])
    expect(plan.create).toEqual([])
  })

  it('never withdraws a chat proposal, one being applied, or anything while the judgement failed', () => {
    const record = [
      recorded('p-chat', 'proposed', [['EG.pdf', 'Bescheide']], { originConversationId: 'conv-1' }),
      recorded('p-busy', 'proposed', [['Fristerstreckung.pdf', 'Bescheide']], { claimed: true }),
    ]
    expect(planFiling(input({ basis: 'content', record })).withdraw).toEqual([])
    expect(planFiling(input({ basis: 'content', judged: false, record: [recorded('p', 'proposed', [['EG.pdf', 'X']])] }))).toEqual({
      create: [],
      withdraw: [],
    })
  })

  describe('two documents of one name in different folders of the batch', () => {
    const PAIR = [
      { id: 'entwurf', filename: 'Plan.pdf' },
      { id: 'einreichung', filename: 'Plan.pdf' },
    ]
    const recordedById = (id: string, status: 'proposed' | 'dismissed', documentId: string, target: string, extra: Partial<RecordedProposal> = {}) => ({
      ...recorded(id, status, [['Plan.pdf', target]], extra),
      payload: {
        operation: 'move' as const,
        operations: [{ document: 'Plan.pdf', document_id: documentId, source: 'project' as const, target_folder: target }],
        basis: 'name' as const,
      },
    })

    it('names each document by its id in the proposal, so the applier moves that one', () => {
      const plan = planFiling(input({ documents: PAIR, batch: PAIR, moves: [move('entwurf', 'Entwurf'), move('einreichung', 'Einreichung')] }))
      expect(plan.create.flatMap((payload) => payload.operations.map((item) => [item.document_id, item.target_folder]))).toEqual([
        ['entwurf', 'Entwurf'],
        ['einreichung', 'Einreichung'],
      ])
    })

    it('lets an open proposal for one of them cover that one only', () => {
      const plan = planFiling(
        input({
          documents: PAIR,
          batch: PAIR,
          moves: [move('entwurf', 'Entwurf'), move('einreichung', 'Einreichung')],
          record: [recordedById('p-open', 'proposed', 'entwurf', 'Entwurf')],
        })
      )
      expect(plan.create.flatMap((payload) => payload.operations.map((item) => item.document_id))).toEqual(['einreichung'])
    })

    it('remembers a dismissal for the document it was made on, not for its namesake', () => {
      const plan = planFiling(
        input({
          documents: PAIR,
          batch: PAIR,
          moves: [move('entwurf', 'Archiv'), move('einreichung', 'Archiv')],
          record: [recordedById('p-no', 'dismissed', 'entwurf', 'Archiv')],
        })
      )
      expect(plan.create.flatMap((payload) => payload.operations.map((item) => item.document_id))).toEqual(['einreichung'])
    })

    it('withdraws a content-revisable suggestion for one of them by its id, whatever its namesake is judged to need', () => {
      const plan = planFiling(
        input({
          basis: 'content',
          documents: PAIR,
          batch: PAIR,
          moves: [move('entwurf', 'Entwurf'), move('einreichung', 'Einreichung')],
          record: [recordedById('p-name', 'proposed', 'einreichung', 'Einreichung'), recordedById('p-stale', 'proposed', 'entwurf', 'Einreichung')],
        })
      )
      expect(plan.withdraw).toEqual(['p-stale'])
      expect(plan.create.flatMap((payload) => payload.operations.map((item) => item.document_id))).toEqual(['entwurf'])
    })
  })

  it('ignores a move for a document it was not given', () => {
    expect(planFiling(input({ moves: [move('ghost', 'Bescheide')] })).create).toEqual([])
  })
})
