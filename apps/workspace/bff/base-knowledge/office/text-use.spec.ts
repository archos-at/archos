import { describe, expect, it } from 'vitest'
import { termsAfter, textUseOf } from './text-use'

const NOW = new Date('2026-11-10T08:00:00.000Z')

describe('whether a copy’s text may be used', () => {
  it('keeps a licensed copy metadata-only until the office states its licence covers AI processing', () => {
    expect(textUseOf('licensed', {})).toBe('metadata_only')
    expect(textUseOf('licensed', { attestedBy: 'u', attestedAt: '2026-11-01T00:00:00.000Z' })).toBe('metadata_only')
    expect(textUseOf('licensed', { aiProcessingAttestedBy: 'u', aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z' })).toBe('used')
  })

  it('uses a public copy’s text without any statement', () => {
    expect(textUseOf('public_open', {})).toBe('used')
    expect(textUseOf('public_restricted', {})).toBe('used')
  })

  it('records who stated what and when, keeps what was not restated, and lets the AI statement be withdrawn', () => {
    const both = termsAfter({}, { licenceAttested: true, aiProcessingAttested: true }, 'user-1', NOW)
    expect(both).toEqual({
      attestedBy: 'user-1',
      attestedAt: NOW.toISOString(),
      aiProcessingAttestedBy: 'user-1',
      aiProcessingAttestedAt: NOW.toISOString(),
    })
    expect(termsAfter(both, {}, 'user-2', NOW)).toEqual(both)
    expect(termsAfter(both, { aiProcessingAttested: false }, 'user-2', NOW)).toEqual({
      attestedBy: 'user-1',
      attestedAt: NOW.toISOString(),
    })
  })
})
