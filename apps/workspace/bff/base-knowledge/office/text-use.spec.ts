import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTE_MAX_CHARS,
  licenceMarkFields,
  licenceMarkOf,
  termsAfter,
  textUseOf,
} from './text-use'

const NOW = new Date('2026-11-10T08:00:00.000Z')

describe('whether a copy’s text may be used', () => {
  it('keeps a licensed copy metadata-only until the office states its licence covers AI processing', () => {
    expect(textUseOf('licensed', {})).toBe('metadata_only')
    expect(textUseOf('licensed', { attestedBy: 'u', attestedAt: '2026-11-01T00:00:00.000Z' })).toBe(
      'metadata_only'
    )
    expect(
      textUseOf('licensed', {
        aiProcessingAttestedBy: 'u',
        aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z',
      })
    ).toBe('used')
  })

  it('uses a public copy’s text without any statement', () => {
    expect(textUseOf('public_open', {})).toBe('used')
    expect(textUseOf('public_restricted', {})).toBe('used')
  })

  it('records who stated what and when, keeps what was not restated, and lets the AI statement be withdrawn', () => {
    const both = termsAfter(
      {},
      { licenceAttested: true, aiProcessingAttested: true },
      'user-1',
      NOW
    )
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

describe('the licence mark a copy’s points carry', () => {
  it('states the AI processing attestation and the quote cap in the payload’s own spelling', () => {
    const attested = {
      aiProcessingAttestedBy: 'u',
      aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z',
      quoteMaxChars: 300,
    }
    expect(licenceMarkFields(licenceMarkOf('licensed', attested))).toEqual({
      licence_class: 'licensed',
      ai_processing_attested: true,
      quote_max_chars: 300,
    })
  })

  it('falls back to the seam’s default cap and reads an unattested copy as not attested', () => {
    expect(licenceMarkOf('licensed', { quoteMaxChars: 0 })).toEqual({
      licenceClass: 'licensed',
      aiProcessingAttested: false,
      quoteMaxChars: DEFAULT_QUOTE_MAX_CHARS,
    })
  })
})
