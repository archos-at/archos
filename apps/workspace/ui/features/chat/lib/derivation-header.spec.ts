import { describe, expect, it } from 'vitest'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import {
  answerAsksBack,
  headerStatus,
  headerWarning,
  worstFinding,
  type HeaderStatusInput,
} from './derivation-header'

const finding = (problem: 'unbacked' | 'contradicted') => ({
  statement: 'Im Burgenland gilt die Ausgabe April 2019.',
  problem,
  reason: 'Keine Passage belegt das Datum.',
  source: 'none',
})

const judged = (...problems: Array<'unbacked' | 'contradicted'>): ConfidenceCheck => ({
  status: 'judged',
  level: 'low',
  findings: problems.map(finding),
})

const settled: HeaderStatusInput = {
  isThinking: false,
  isWaiting: false,
  isInterrupted: false,
  isRecoveryPending: false,
  isStopped: false,
  asksBack: false,
  worst: null,
}

describe('worstFinding', () => {
  it('names a contradiction before any unbacked statement, with its own count', () => {
    expect(worstFinding(judged('unbacked', 'contradicted', 'unbacked'))).toEqual({
      problem: 'contradicted',
      count: 1,
    })
  })

  it('counts the unbacked statements when nothing is contradicted', () => {
    expect(worstFinding(judged('unbacked', 'unbacked'))).toEqual({ problem: 'unbacked', count: 2 })
  })

  it('has nothing to name for a clean, unavailable or missing check', () => {
    expect(worstFinding(judged())).toBeNull()
    expect(worstFinding({ status: 'unavailable', findings: [] })).toBeNull()
    expect(worstFinding(undefined)).toBeNull()
  })
})

describe('headerStatus', () => {
  it('is done, with the green check, only for an answer the check found nothing in', () => {
    expect(headerStatus(settled)).toBe('done')
  })

  it('is flagged when the check found a statement unbacked or contradicted', () => {
    expect(headerStatus({ ...settled, worst: { problem: 'unbacked', count: 2 } })).toBe('flagged')
  })

  it('is askedBack for an answer that ends with a question, findings or not', () => {
    expect(headerStatus({ ...settled, asksBack: true })).toBe('askedBack')
    expect(
      headerStatus({ ...settled, asksBack: true, worst: { problem: 'unbacked', count: 1 } })
    ).toBe('askedBack')
  })

  it('leaves the verdict out until the turn ended with an answer', () => {
    const verdict = { asksBack: true, worst: { problem: 'unbacked' as const, count: 1 } }
    expect(headerStatus({ ...settled, ...verdict, isThinking: true })).toBe('live')
    expect(headerStatus({ ...settled, ...verdict, isWaiting: true })).toBe('waiting')
    expect(headerStatus({ ...settled, ...verdict, isInterrupted: true })).toBe('interrupted')
    expect(
      headerStatus({ ...settled, ...verdict, isInterrupted: true, isRecoveryPending: true })
    ).toBe('recovering')
    expect(headerStatus({ ...settled, ...verdict, isStopped: true })).toBe('stopped')
    expect(headerStatus({ ...settled, ...verdict, endedAs: 'failed' })).toBe('failed')
    expect(headerStatus({ ...settled, ...verdict, endedAs: 'handed_off' })).toBe('handedOff')
    expect(headerStatus({ ...settled, ...verdict, endedAs: 'refused' })).toBe('refused')
  })
})

describe('headerWarning', () => {
  const calls = { failed: 1, open: 2 }

  it('puts the worst finding above a failed call and an open point', () => {
    expect(headerWarning('flagged', { problem: 'unbacked', count: 2 }, calls)).toEqual({
      kind: 'unbacked',
      count: 2,
    })
  })

  it('keeps a failed call above an open point when the check found nothing', () => {
    expect(headerWarning('done', null, calls)).toEqual({ kind: 'failed', count: 1 })
    expect(headerWarning('done', null, { failed: 0, open: 2 })).toEqual({ kind: 'open', count: 2 })
  })

  it('carries the finding on an answer that asked back', () => {
    expect(headerWarning('askedBack', { problem: 'contradicted', count: 1 }, calls)).toEqual({
      kind: 'contradicted',
      count: 1,
    })
  })

  it('says nothing while the turn is not settled with an answer', () => {
    expect(headerWarning('live', { problem: 'unbacked', count: 1 }, calls)).toBeNull()
    expect(headerWarning('stopped', null, calls)).toBeNull()
  })
})

describe('answerAsksBack', () => {
  it('reads the last line of prose as a question', () => {
    expect(
      answerAsksBack(
        'Das hängt vom Landesrecht ab.\n\nIn welchem Land und Bundesland liegt das Bauvorhaben?'
      )
    ).toBe(true)
  })

  it('looks past the sources list that closes an answer', () => {
    expect(
      answerAsksBack(
        'Welche Fläche hat das Geschoß?\n\n## Quellen\n- [1] [KB] oib-rl_4.pdf, p.11\n'
      )
    ).toBe(true)
  })

  it('accepts a question inside emphasis or quotes', () => {
    expect(answerAsksBack('**Liegt das Grundstück in Graz?**')).toBe(true)
  })

  it('is false for an answer that ends with a statement, or has a question mid-text', () => {
    expect(answerAsksBack('Gilt das auch hier? Ja, ab 12 m sind es 1,10 m [1].')).toBe(false)
    expect(
      answerAsksBack('Mindestens 1,00 m [1].\n\n## Quellen\n- [1] [KB] oib-rl_4.pdf, p.11')
    ).toBe(false)
    expect(answerAsksBack(undefined)).toBe(false)
    expect(answerAsksBack('')).toBe(false)
  })
})
