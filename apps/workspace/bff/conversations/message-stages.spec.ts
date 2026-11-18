/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_FOLLOW_UPS,
  MAX_MEMORY_ITEMS,
  sanitizeFollowUpsStage,
  sanitizeMemoryReflectionStage,
  sanitizeStages,
} from './message-stages'

const questions = (n: number) =>
  Array.from({ length: n }, (_, index) => ({ question: `Frage ${index + 1}?` }))

describe('sanitizeFollowUpsStage', () => {
  it('keeps a well-formed question and its hint', () => {
    expect(
      sanitizeFollowUpsStage({
        items: [{ question: 'Wie wird das Fluchtniveau gemessen?', hint: 'Messpunkt und Bezugsebene' }],
      }),
    ).toEqual({
      items: [{ question: 'Wie wird das Fluchtniveau gemessen?', hint: 'Messpunkt und Bezugsebene' }],
    })
  })

  it('drops a hint that is not there rather than storing an empty one', () => {
    expect(sanitizeFollowUpsStage({ items: [{ question: 'Und bei Hanglage?', hint: '  ' }] })).toEqual({
      items: [{ question: 'Und bei Hanglage?' }],
    })
  })

  it('truncates past the fourth question', () => {
    const stage = sanitizeFollowUpsStage({ items: questions(9) })
    expect(stage?.items).toHaveLength(MAX_FOLLOW_UPS)
    expect(stage?.items.at(-1)?.question).toBe('Frage 4?')
  })

  it('caps a question that arrived as a paragraph', () => {
    const stage = sanitizeFollowUpsStage({ items: [{ question: 'x'.repeat(5000) }] })
    expect(stage?.items[0].question).toHaveLength(300)
  })

  it('skips an item with no question and keeps its siblings', () => {
    const stage = sanitizeFollowUpsStage({
      items: [{ hint: 'nur ein Hinweis' }, { question: '   ' }, { question: 'Und die Gebäudeklasse?' }],
    })
    expect(stage?.items).toEqual([{ question: 'Und die Gebäudeklasse?' }])
  })

  it('is null when nothing usable survives', () => {
    expect(sanitizeFollowUpsStage({ items: [{ hint: 'nur ein Hinweis' }] })).toBeNull()
    expect(sanitizeFollowUpsStage({ items: 'Wie wird gemessen?' })).toBeNull()
    expect(sanitizeFollowUpsStage(null)).toBeNull()
    expect(sanitizeFollowUpsStage([{ question: 'Als Array?' }])).toBeNull()
  })
})

const noted = (n: number) =>
  Array.from({ length: n }, (_, index) => ({
    id: `item-${index + 1}`,
    kind: 'derived_fact',
    content: `Notiz ${index + 1}`,
  }))

describe('sanitizeMemoryReflectionStage', () => {
  it('keeps a well-formed item whole', () => {
    expect(
      sanitizeMemoryReflectionStage({
        items: [{ id: '9d2f6b41', kind: 'constraint', content: 'Das Projekt liegt in Wien.' }],
      }),
    ).toEqual({ items: [{ id: '9d2f6b41', kind: 'constraint', content: 'Das Projekt liegt in Wien.' }] })
  })

  it('keeps what an item says about when it was written, where it went and what it replaced', () => {
    const item = { id: 'n-1', kind: 'decision', content: 'Die Bauherrschaft will ein Flachdach.' }
    expect(
      sanitizeMemoryReflectionStage({
        items: [
          { ...item, provenance: 'agent', scope: 'organization' },
          { ...item, id: 'n-2', supersedes: ' Die Bauherrschaft will ein Satteldach. ', restricted: true },
        ],
      })?.items,
    ).toEqual([
      { ...item, provenance: 'agent', scope: 'organization' },
      { ...item, id: 'n-2', supersedes: 'Die Bauherrschaft will ein Satteldach.', restricted: true },
    ])
  })

  it('reads a value outside the closed sets as the default it is absent for', () => {
    const [stored] =
      sanitizeMemoryReflectionStage({
        items: [
          {
            id: 'n-1',
            kind: 'decision',
            content: 'Flachdach.',
            provenance: 'user',
            scope: 'personal',
            restricted: 'yes',
            supersedes: 7,
            owner: 'user_2',
          },
        ],
      })?.items ?? []
    expect(stored).toEqual({ id: 'n-1', kind: 'decision', content: 'Flachdach.' })
  })

  it('has no place for a personal note: its kinds are refused (ADR-0180)', () => {
    expect(sanitizeMemoryReflectionStage({ items: [{ id: 'p-1', kind: 'profile', content: 'Leitet die Einreichplanung.' }] })).toBeNull()
  })

  it('drops an item whose kind is not one a project_memory row can carry', () => {
    expect(
      sanitizeMemoryReflectionStage({
        items: [
          { id: 'a', kind: 'sonstiges', content: 'Etwas' },
          { id: 'b', kind: 'preference', content: 'Der Kunde bevorzugt Flachdächer.' },
        ],
      }),
    ).toEqual({ items: [{ id: 'b', kind: 'preference', content: 'Der Kunde bevorzugt Flachdächer.' }] })
  })

  it('drops a malformed item INDIVIDUALLY and keeps its siblings', () => {
    const stage = sanitizeMemoryReflectionStage({
      items: [
        { kind: 'decision', content: 'ohne id' },
        { id: 'c', kind: 'decision', content: '   ' },
        'nicht einmal ein Objekt',
        { id: 'd', kind: 'decision', content: 'Flachdach beschlossen.' },
      ],
    })
    expect(stage?.items).toEqual([{ id: 'd', kind: 'decision', content: 'Flachdach beschlossen.' }])
  })

  it('caps the list and the content', () => {
    expect(sanitizeMemoryReflectionStage({ items: noted(20) })?.items).toHaveLength(MAX_MEMORY_ITEMS)
    const long = sanitizeMemoryReflectionStage({
      items: [{ id: 'a', kind: 'decision', content: 'x'.repeat(5000) }],
    })
    expect(long?.items[0].content).toHaveLength(500)
  })

  it('is null when nothing usable survives', () => {
    expect(sanitizeMemoryReflectionStage({ items: [] })).toBeNull()
    expect(sanitizeMemoryReflectionStage({ items: [{ id: 'a', kind: 'decision' }] })).toBeNull()
    expect(sanitizeMemoryReflectionStage(null)).toBeNull()
  })
})

describe('sanitizeStages', () => {
  it('keeps the stages this build knows', () => {
    expect(sanitizeStages({ followUps: { items: [{ question: 'Und bei Hanglage?' }] } })).toEqual({
      followUps: { items: [{ question: 'Und bei Hanglage?' }] },
    })
  })

  it('keeps two stages side by side, under their own keys', () => {
    expect(
      sanitizeStages({
        followUps: { items: [{ question: 'Und bei Hanglage?' }] },
        memoryReflection: { items: [{ id: 'a', kind: 'decision', content: 'Flachdach beschlossen.' }] },
      }),
    ).toEqual({
      followUps: { items: [{ question: 'Und bei Hanglage?' }] },
      memoryReflection: { items: [{ id: 'a', kind: 'decision', content: 'Flachdach beschlossen.' }] },
    })
  })

  it('drops a stage key this build has never heard of', () => {
    expect(
      sanitizeStages({
        followUps: { items: [{ question: 'Und bei Hanglage?' }] },
        somethingElse: { anything: 'x'.repeat(100000) },
      }),
    ).toEqual({ followUps: { items: [{ question: 'Und bei Hanglage?' }] } })
  })

  it('is null when nothing survives, so the caller can skip the write', () => {
    expect(sanitizeStages({ somethingElse: { items: [] } })).toBeNull()
    expect(sanitizeStages('followUps')).toBeNull()
    expect(sanitizeStages(undefined)).toBeNull()
  })
})
