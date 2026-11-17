import { describe, expect, it } from 'vitest'
import type { AnswerCard } from '@/shared/cards/schemas'
import { findCardOwnerMessageId, type CardOwnerConversation } from './card-owner'

const proposal = (content: string): AnswerCard =>
  ({
    type: 'memory_proposal',
    title: 'Merken?',
    content,
    kind: 'preference',
    confidence: 'high',
  }) as AnswerCard

const REPORT_CARDS: AnswerCard[] = [proposal('REI 90 bei GK4')]

const thread = (
  messages: CardOwnerConversation['messages'],
  id = 'conv-1'
): CardOwnerConversation => ({ id, messages })

describe('findCardOwnerMessageId', () => {
  it('names the message the job wrote its answer to', () => {
    const conversation = thread([
      { id: 'tracking', deepResearchJobId: 'job-1' },
      { id: 'answer', deepResearchJobId: 'job-1', cards: REPORT_CARDS },
    ])

    expect(
      findCardOwnerMessageId({ currentConversation: conversation }, 'job-1', REPORT_CARDS)
    ).toBe('answer')
  })

  it('finds the owner in a thread that is no longer open', () => {
    const other = thread([{ id: 'answer', deepResearchJobId: 'job-1', cards: REPORT_CARDS }], 'conv-2')

    expect(
      findCardOwnerMessageId(
        { currentConversation: thread([{ id: 'unrelated' }]), conversations: [other] },
        'job-1',
        REPORT_CARDS
      )
    ).toBe('answer')
  })

  it('refuses a message of the same run whose cards are NOT these cards', () => {
    const conversation = thread([
      { id: 'tracking', deepResearchJobId: 'job-1', cards: [proposal('etwas ganz anderes')] },
    ])

    expect(
      findCardOwnerMessageId({ currentConversation: conversation }, 'job-1', REPORT_CARDS)
    ).toBeNull()
  })

  it('refuses a message carrying these cards but belonging to another run', () => {
    const conversation = thread([
      { id: 'other-run', deepResearchJobId: 'job-2', cards: REPORT_CARDS },
    ])

    expect(
      findCardOwnerMessageId({ currentConversation: conversation }, 'job-1', REPORT_CARDS)
    ).toBeNull()
  })

  it('has no owner while the run is still in flight', () => {
    const conversation = thread([{ id: 'tracking', deepResearchJobId: 'job-1' }])

    expect(
      findCardOwnerMessageId({ currentConversation: conversation }, 'job-1', REPORT_CARDS)
    ).toBeNull()
  })

  it('has no owner without a run to name', () => {
    const conversation = thread([{ id: 'answer', deepResearchJobId: 'job-1', cards: REPORT_CARDS }])

    expect(findCardOwnerMessageId({ currentConversation: conversation }, null, REPORT_CARDS)).toBeNull()
    expect(findCardOwnerMessageId({ currentConversation: conversation }, 'job-1', [])).toBeNull()
  })

  it('survives a store with nothing loaded', () => {
    expect(findCardOwnerMessageId({}, 'job-1', REPORT_CARDS)).toBeNull()
  })

  it('resolves a tie to the later message — the answer, not the tracking bubble', () => {
    const conversation = thread([
      { id: 'tracking', deepResearchJobId: 'job-1', cards: REPORT_CARDS },
      { id: 'answer', deepResearchJobId: 'job-1', cards: REPORT_CARDS },
    ])

    expect(
      findCardOwnerMessageId({ currentConversation: conversation }, 'job-1', REPORT_CARDS)
    ).toBe('answer')
  })

  it('does not search the open conversation twice', () => {
    const conversation = thread([{ id: 'answer', deepResearchJobId: 'job-1', cards: REPORT_CARDS }])

    expect(
      findCardOwnerMessageId(
        { currentConversation: conversation, conversations: [{ ...conversation, messages: [] }] },
        'job-1',
        REPORT_CARDS
      )
    ).toBe('answer')
  })
})
