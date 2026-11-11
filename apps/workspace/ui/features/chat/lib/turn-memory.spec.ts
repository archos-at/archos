/**
 * @vitest-environment node
 */
/**
 * What one turn recorded — and, above all, what it did NOT record
 * (`docs/architecture/post-answer-stages.md` §1.1).
 *
 * Three paths write project memory and only one of them is the post-answer
 * stage. The chip renders two of them and must keep them apart: „während der
 * Antwort notiert" and „nach der Antwort ergänzt" are different promises to the
 * reader, and collapsing them would turn a proposal they answered into
 * something the machine decided on its own, or the reverse.
 *
 * A node-environment spec over a pure module, deliberately: this is the logic,
 * and logic that lives in a render function costs 172ms a case to test instead
 * of one (AGENTS.md).
 */
import { describe, expect, it } from 'vitest'
import type { AnswerCard } from '@/shared/cards/schemas'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { DecidedProposals } from '@/features/cards/decided-proposals'
import type { ProposedChangeView } from '@/lib/proposals/types'
import { turnMemoryItems } from './turn-memory'

const proposal = (content: string): AnswerCard =>
  ({
    type: 'memory_proposal',
    title: 'Neue Erkenntnis merken',
    content,
    kind: 'constraint',
    confidence: 'high',
  }) as AnswerCard

const reflected = {
  memoryReflection: {
    items: [
      { id: 'row-1', kind: 'derived_fact', content: 'Das oberste Fluchtniveau beträgt 9,80 m.' },
    ],
  },
}

const answered = (decision: string): CardInteractions => ({
  'memory_proposal-0': { decision, decidedAt: '2026-08-19T10:31:00.000Z' } as CardInteractions[string],
})

const PROPOSAL_ID = '00000000-0000-4000-8000-0000000000a1'

/** A memory card the server holds (`proposal_id`): the card is the receipt of a stored proposal. */
const serverProposal = (content: string): AnswerCard =>
  ({ ...proposal(content), proposal_id: PROPOSAL_ID }) as AnswerCard

const stored = (status: ProposedChangeView['status']): DecidedProposals => ({
  [PROPOSAL_ID]: { id: PROPOSAL_ID, kind: 'memory', status } as ProposedChangeView,
})

describe('turnMemoryItems', () => {
  it('is empty for a turn that recorded nothing', () => {
    // The common case, and the reason the chip renders nothing at all rather
    // than an empty popover.
    expect(turnMemoryItems({})).toEqual([])
    expect(turnMemoryItems({ cards: [proposal('Noch nicht entschieden')] })).toEqual([])
  })

  it('reports what the reflection stage wrote, marked as after the answer', () => {
    expect(turnMemoryItems({ stages: reflected })).toEqual([
      {
        id: 'row-1',
        kind: 'derived_fact',
        content: 'Das oberste Fluchtniveau beträgt 9,80 m.',
        provenance: 'distillation',
        // The stage writes the project's memory only, and its frame leaves a personal note out.
        audience: 'project',
        // The row it wrote: what taking the note back deletes.
        noteId: 'row-1',
      },
    ])
  })

  describe('every save of the turn, with its shelf (ADR-0180)', () => {
    const frame = {
      memoryReflection: {
        items: [
          { id: 'n-1', kind: 'decision', content: 'Die Bauherrschaft will ein Flachdach.', provenance: 'agent' as const },
          {
            id: 'n-2',
            kind: 'preference',
            content: 'Brandschutzkonzepte werden vorabgestimmt.',
            provenance: 'agent' as const,
            scope: 'organization' as const,
          },
          { id: 'n-3', kind: 'constraint', content: 'Die Statik ist freigegeben.', restricted: true as const },
          {
            id: 'n-4',
            kind: 'derived_fact',
            content: 'OIB-RL 2.1 gilt.',
            supersedes: 'OIB-RL 2.1 gilt nicht.',
          },
        ],
      },
    }
    const mine = [
      { id: 'p-1', kind: 'profile', content: 'Leitet die Einreichplanung.', provenanceType: 'distillation' },
      { id: 'p-2', kind: 'preference', content: 'Will kurze Antworten.', provenanceType: 'agent' },
    ]

    it('shows a note the tool saved on its own, with no card, as written during the answer', () => {
      const [project, office] = turnMemoryItems({ stages: frame })
      expect(project).toEqual({
        id: 'n-1',
        noteId: 'n-1',
        kind: 'decision',
        content: 'Die Bauherrschaft will ein Flachdach.',
        provenance: 'inTurn',
        audience: 'project',
      })
      expect(office).toMatchObject({ noteId: 'n-2', provenance: 'inTurn', audience: 'organization' })
    })

    it('says a restricted note is read by fewer people than the project, and carries what a note replaced', () => {
      const items = turnMemoryItems({ stages: frame })
      expect(items.find((item) => item.id === 'n-3')).toMatchObject({ audience: 'restricted', provenance: 'distillation' })
      expect(items.find((item) => item.id === 'n-4')?.supersedes).toBe('OIB-RL 2.1 gilt nicht.')
      expect(items.find((item) => item.id === 'n-1')).not.toHaveProperty('supersedes')
    })

    it('adds the reader’s own personal notes of this answer, read by nobody else', () => {
      const items = turnMemoryItems({ stages: frame, personalNotes: mine })
      const personal = items.filter((item) => item.audience === 'personal')
      expect(personal).toEqual([
        { id: 'p-2', noteId: 'p-2', kind: 'preference', content: 'Will kurze Antworten.', provenance: 'inTurn', audience: 'personal' },
        { id: 'p-1', noteId: 'p-1', kind: 'profile', content: 'Leitet die Einreichplanung.', provenance: 'distillation', audience: 'personal' },
      ])
    })

    it('shows another reader of the same message no personal row: it is not on the message', () => {
      // The colleague's browser holds the same message and an empty list of their own.
      const theirs = turnMemoryItems({ stages: frame, personalNotes: [] })
      expect(theirs.map((item) => item.audience)).toEqual(['project', 'organization', 'restricted', 'project'])
      expect(JSON.stringify(frame)).not.toContain('Einreichplanung')
    })

    it('lists everything written during the answer ahead of everything added after it', () => {
      const items = turnMemoryItems({ stages: frame, personalNotes: mine })
      expect(items.map((item) => [item.id, item.provenance])).toEqual([
        ['n-1', 'inTurn'],
        ['n-2', 'inTurn'],
        ['p-2', 'inTurn'],
        ['n-3', 'distillation'],
        ['n-4', 'distillation'],
        ['p-1', 'distillation'],
      ])
    })

    it('names the note an accepted server proposal created, and none for a card the browser decided', () => {
      const cards = [serverProposal('Die Fluchtwegbreite ist mit 1,20 m vorgegeben.')]
      const decided: DecidedProposals = {
        [PROPOSAL_ID]: {
          id: PROPOSAL_ID,
          kind: 'memory',
          status: 'applied',
          results: [{ label: 'Notiz', ok: true, scope: 'project', itemId: 'created-1' }],
        } as ProposedChangeView,
      }
      expect(turnMemoryItems({ cards, decidedProposals: decided })[0]?.noteId).toBe('created-1')
      const older = turnMemoryItems({ cards: [proposal('Alt.')], cardInteractions: answered('savedProject') })
      expect(older[0]).not.toHaveProperty('noteId')
    })
  })

  it('reports an ACCEPTED memory proposal, marked as during the answer', () => {
    const items = turnMemoryItems({
      cards: [proposal('Die Fluchtwegbreite ist mit 1,20 m vorgegeben.')],
      cardInteractions: answered('savedProject'),
    })
    expect(items).toEqual([
      {
        id: 'memory_proposal-0',
        kind: 'constraint',
        content: 'Die Fluchtwegbreite ist mit 1,20 m vorgegeben.',
        provenance: 'inTurn',
        audience: 'project',
      },
    ])
  })

  it('says who reads the note by where the reader’s decision put it', () => {
    const cards = [proposal('Die Fluchtwegbreite ist mit 1,20 m vorgegeben.')]
    expect(turnMemoryItems({ cards, cardInteractions: answered('savedOrg') })[0]?.audience).toBe('organization')
    expect(turnMemoryItems({ cards, cardInteractions: answered('savedProject') })[0]?.audience).toBe('project')
  })

  it('reads a server proposal’s audience from its result, and claims none when it recorded none', () => {
    const cards = [serverProposal('Die Fluchtwegbreite ist mit 1,20 m vorgegeben.')]
    const applied = (results: ProposedChangeView['results']): DecidedProposals => ({
      [PROPOSAL_ID]: { id: PROPOSAL_ID, kind: 'memory', status: 'applied', results } as ProposedChangeView,
    })
    const inProject = applied([{ label: 'Notiz', ok: true, scope: 'project' }])
    expect(turnMemoryItems({ cards, decidedProposals: inProject })[0]?.audience).toBe('project')
    expect(turnMemoryItems({ cards, decidedProposals: applied(null) })[0]).not.toHaveProperty('audience')
  })

  it('carries the note an accepted proposal corrected, so the chip can say it changed', () => {
    const correction = {
      ...proposal('Die Fluchtwegbreite ist mit 1,50 m vorgegeben.'),
      supersedes: 'Die Fluchtwegbreite ist mit 1,20 m vorgegeben.',
    } as AnswerCard
    const [item] = turnMemoryItems({ cards: [correction], cardInteractions: answered('savedProject') })
    expect(item?.supersedes).toBe('Die Fluchtwegbreite ist mit 1,20 m vorgegeben.')
  })

  it('treats a blank or null supersedes as a new note, not a correction', () => {
    for (const supersedes of [null, '   ']) {
      const card = { ...proposal('Neu.'), supersedes } as AnswerCard
      const [item] = turnMemoryItems({ cards: [card], cardInteractions: answered('savedProject') })
      expect(item).not.toHaveProperty('supersedes')
    }
  })

  it('does not claim a proposal the reader dismissed or has not answered', () => {
    // The card's own tool result says it in as many words: "It has NOT been
    // saved yet — do not claim it was saved; the user decides." A chip whose
    // entire job is to say what is now durable about a project may not be the
    // thing that gets that wrong.
    const cards = [proposal('Org-weite Konvention')]
    expect(turnMemoryItems({ cards, cardInteractions: answered('dismissed') })).toEqual([])
    expect(turnMemoryItems({ cards, cardInteractions: {} })).toEqual([])
  })

  it('keeps the two paths apart and in the order they happened', () => {
    // The subtlety this module exists for: three paths surface memory and only
    // one is the stage. The in-turn tool ran while the answer was being
    // written; the stage ran after it was finished.
    const items = turnMemoryItems({
      stages: reflected,
      cards: [proposal('Die Fluchtwegbreite ist mit 1,20 m vorgegeben.')],
      cardInteractions: answered('savedOrg'),
    })
    expect(items.map((item) => item.provenance)).toEqual(['inTurn', 'distillation'])
  })

  it('ignores the other cards of an answer', () => {
    // A `calculation` is not a memory, and the fallback block of an answer
    // holds cards of every kind.
    const items = turnMemoryItems({
      cards: [{ type: 'calculation', title: 'Schrittmaß', steps: [] } as unknown as AnswerCard],
      cardInteractions: { 'calculation-0': { decision: 'savedOrg', decidedAt: 'x' } as CardInteractions[string] },
    })
    expect(items).toEqual([])
  })

  describe('a memory card the server decides (proposal_id)', () => {
    const cards = [serverProposal('Die Fluchtwegbreite ist mit 1,20 m vorgegeben.')]

    it('reports a proposal the server applied', () => {
      expect(turnMemoryItems({ cards, decidedProposals: stored('applied') })).toEqual([
        {
          id: 'memory_proposal-0',
          kind: 'constraint',
          content: 'Die Fluchtwegbreite ist mit 1,20 m vorgegeben.',
          provenance: 'inTurn',
        },
      ])
    })

    it('does not claim one that was dismissed, failed, or is still open', () => {
      for (const status of ['dismissed', 'failed', 'proposed'] as const) {
        expect(turnMemoryItems({ cards, decidedProposals: stored(status) })).toEqual([])
      }
    })

    it('does not claim one the tab has not seen decided', () => {
      expect(turnMemoryItems({ cards, decidedProposals: {} })).toEqual([])
      expect(turnMemoryItems({ cards })).toEqual([])
    })

    it('reads the proposal and never cardInteractions', () => {
      // A server card writes none; a stale decision on the message does not make it remembered.
      expect(turnMemoryItems({ cards, cardInteractions: answered('savedOrg'), decidedProposals: {} })).toEqual([])
    })

    it('leaves a card without a proposal_id on its cardInteractions', () => {
      const legacy = [proposal('Ältere Antwort')]
      expect(turnMemoryItems({ cards: legacy, cardInteractions: answered('savedOrg'), decidedProposals: stored('dismissed') })).toHaveLength(1)
    })
  })
})
