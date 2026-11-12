/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { sanitizeConfidenceCheck } from './confidence-check'

describe('sanitizeConfidenceCheck', () => {
  test('keeps a judged check and bounds its findings', () => {
    const findings = Array.from({ length: 12 }, (_, i) => ({
      statement: `s${i}`,
      problem: 'unbacked',
      reason: 'r',
      source: 'none',
    }))
    const check = sanitizeConfidenceCheck({ status: 'judged', level: 'medium', findings })
    expect(check?.level).toBe('medium')
    expect(check?.findings).toHaveLength(8)
  })

  test('a judged check with no findings on the wire reads as none', () => {
    expect(sanitizeConfidenceCheck({ status: 'judged', level: 'high' })).toEqual({
      status: 'judged',
      level: 'high',
      findings: [],
    })
  })

  test('drops a finding of an unknown kind and reads a judged check without a level as unavailable', () => {
    expect(
      sanitizeConfidenceCheck({
        status: 'judged',
        level: 'low',
        findings: [{ statement: 'x', problem: 'invented', reason: '', source: '' }],
      })?.findings
    ).toEqual([])
    expect(sanitizeConfidenceCheck({ status: 'judged', level: 'certain' })).toEqual({
      status: 'unavailable',
      findings: [],
    })
  })

  test('keeps why an unavailable check gave no level, from the wire and from stored provenance', () => {
    const wire = {
      status: 'unavailable',
      unavailable_reason: {
        cause: 'unparseable',
        finish_reason: 'length',
        truncated: true,
        elapsed_ms: 9100,
        evidence_chars: 58000,
        answer_chars: 2400,
      },
    }
    const stored = {
      status: 'unavailable',
      findings: [],
      unavailableReason: {
        cause: 'unparseable',
        finishReason: 'length',
        truncated: true,
        elapsedMs: 9100,
        evidenceChars: 58000,
        answerChars: 2400,
      },
    }
    expect(sanitizeConfidenceCheck(wire)).toEqual(stored)
    expect(sanitizeConfidenceCheck(stored)).toEqual(stored)
    expect(
      sanitizeConfidenceCheck({ status: 'unavailable', unavailable_reason: { cause: 'error', error_type: 'x'.repeat(500) } })
        ?.unavailableReason?.errorType
    ).toHaveLength(100)
  })

  test('an unknown cause, or a reason on a judged check, is dropped', () => {
    expect(sanitizeConfidenceCheck({ status: 'unavailable', unavailable_reason: { cause: 'gremlins' } })).toEqual({
      status: 'unavailable',
      findings: [],
    })
    expect(
      sanitizeConfidenceCheck({ status: 'judged', level: 'high', unavailable_reason: { cause: 'timeout' } })
    ).toEqual({ status: 'judged', level: 'high', findings: [] })
  })

  test('anything else is no check', () => {
    expect(sanitizeConfidenceCheck(null)).toBeUndefined()
    expect(sanitizeConfidenceCheck({ status: 'maybe' })).toBeUndefined()
  })
})
