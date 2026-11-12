import { describe, expect, it } from 'vitest'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import {
  answerAsksBack,
  headerStatus,
  headerWarning,
  worstFinding,
  type HeaderStatusInput,
  type WorstFinding,
} from './derivation-header'

type Problem = 'unbacked' | 'contradicted'

const finding = (problem: Problem) => ({
  statement: 'Im Burgenland gilt die Ausgabe April 2019.',
  problem,
  reason: 'Keine Passage belegt das Datum.',
  source: 'none',
})

const judged = (level: 'low' | 'medium' | 'high', ...problems: Problem[]): ConfidenceCheck => ({
  status: 'judged',
  level,
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

const sinking: WorstFinding = { problem: 'unbacked', count: 2, sinks: true }
const mild: WorstFinding = { problem: 'unbacked', count: 1, sinks: false }

describe('worstFinding', () => {
  it('names a contradiction before any unbacked statement, with its own count', () => {
    expect(worstFinding(judged('medium', 'unbacked', 'contradicted', 'unbacked'))).toEqual({
      problem: 'contradicted',
      count: 1,
      sinks: true,
    })
  })

  it('sinks the answer for unbacked statements only when the check rated it low', () => {
    expect(worstFinding(judged('low', 'unbacked', 'unbacked'))).toEqual(sinking)
    expect(worstFinding(judged('medium', 'unbacked'))).toEqual(mild)
  })

  it('has nothing to name for a clean, unavailable or missing check', () => {
    expect(worstFinding(judged('low'))).toBeNull()
    expect(worstFinding({ status: 'unavailable', findings: [] })).toBeNull()
    expect(worstFinding(undefined)).toBeNull()
  })
})

describe('headerStatus', () => {
  it('is done for an answer the check found nothing in', () => {
    expect(headerStatus(settled)).toBe('done')
  })

  it('is flagged for a finding that sinks the answer', () => {
    expect(headerStatus({ ...settled, worst: sinking })).toBe('flagged')
  })

  it('stays done for a mostly backed answer: medium, only unbacked side statements', () => {
    expect(headerStatus({ ...settled, worst: mild })).toBe('done')
  })

  it('is askedBack for an answer that asks back, under a mild finding too', () => {
    expect(headerStatus({ ...settled, asksBack: true })).toBe('askedBack')
    expect(headerStatus({ ...settled, asksBack: true, worst: mild })).toBe('askedBack')
  })

  it('ranks a finding that sinks the answer above asking back', () => {
    expect(headerStatus({ ...settled, asksBack: true, worst: sinking })).toBe('flagged')
  })

  it('leaves the verdict out until the turn ended with an answer', () => {
    const verdict = { asksBack: true, worst: sinking }
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

  it('puts the worst finding above a failed call and an open point, mild or not', () => {
    expect(headerWarning('flagged', sinking, calls)).toEqual({ kind: 'unbacked', count: 2 })
    expect(headerWarning('done', mild, calls)).toEqual({ kind: 'unbacked', count: 1 })
  })

  it('keeps a failed call above an open point when the check found nothing', () => {
    expect(headerWarning('done', null, calls)).toEqual({ kind: 'failed', count: 1 })
    expect(headerWarning('done', null, { failed: 0, open: 2 })).toEqual({ kind: 'open', count: 2 })
  })

  it('carries the finding on an answer that asked back', () => {
    expect(headerWarning('askedBack', mild, calls)).toEqual({ kind: 'unbacked', count: 1 })
  })

  it('says nothing while the turn is not settled with an answer', () => {
    expect(headerWarning('live', sinking, calls)).toBeNull()
    expect(headerWarning('stopped', null, calls)).toBeNull()
  })
})

describe('answerAsksBack', () => {
  it('reads the last line of an uncited answer as a question back', () => {
    const text = 'Das hängt vom Landesrecht ab.\n\nIn welchem Land und Bundesland liegt das Bauvorhaben?'
    expect(answerAsksBack(text, 0)).toBe(true)
  })

  it('accepts a question inside emphasis or quotes', () => {
    expect(answerAsksBack('**Liegt das Grundstück in Graz?**', 0)).toBe(true)
  })

  // The agent states an assumption up front and closes with an invitation to
  // correct it (chat_static.md): a complete answer, not a question back.
  it('is false for a cited answer under an assumption that invites a correction', () => {
    const text =
      'Ich gehe von Wien aus. Die Absturzsicherung muss mindestens 1,00 m hoch sein [1].\n\n' +
      'Liegt das Projekt in einem anderen Bundesland?\n\n## Quellen\n- [1] [KB] oib-rl_4.pdf, p.11'
    expect(answerAsksBack(text, 1)).toBe(false)
    // The same shape with its citations dropped from the message still carries its marker.
    expect(answerAsksBack(text, 0)).toBe(false)
  })

  it('is false for any answer that cites, even when its last line is a question', () => {
    expect(answerAsksBack('Mindestens 1,00 m.\n\nSoll ich die Brüstung prüfen?', 2)).toBe(false)
  })

  it('is false for an answer that ends with a statement, or has a question mid-text', () => {
    expect(answerAsksBack('Gilt das auch hier? Ja, ab 12 m sind es 1,10 m.', 0)).toBe(false)
    expect(answerAsksBack(undefined, 0)).toBe(false)
    expect(answerAsksBack('', 0)).toBe(false)
  })
})
