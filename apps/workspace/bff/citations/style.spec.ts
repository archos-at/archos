/**
 * @vitest-environment node
 *
 * The style an office's lines are written in: its home country's released
 * `citation_style` ruleset in force today, or none (the reader's fallback).
 */

import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_CITATION_STYLES } from '@/shared/citation-style-fallback'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'

vi.mock('server-only', () => ({}))
const findOrganization = vi.fn()
const readRulesetsInForce = vi.fn()
vi.mock('@/lib/organizations/repository', () => ({ findOrganization: (id: string) => findOrganization(id) }))
vi.mock('@/lib/base-knowledge/store/rulesets', () => ({ readRulesetsInForce: (...args: unknown[]) => readRulesetsInForce(...args) }))

import { citationStylesFor } from './style'

const ruleset = (validFrom: string): StoredRuleset => ({
  id: 'ruleset:xa-citation-style',
  values: {
    purpose: 'citation_style',
    territoryIds: ['XA'],
    workIds: [],
    validFrom,
    validTo: null,
    basisEditionId: null,
    body: { kind: 'citation_style', payloadSchema: 'citation_style.v1', payload: FALLBACK_CITATION_STYLES },
  },
})
const NOW = new Date('2026-11-11T10:00:00Z')

describe('citationStylesFor', () => {
  it('answers the home country’s style in force today', async () => {
    findOrganization.mockResolvedValue({ homeCountry: 'XA' })
    readRulesetsInForce.mockResolvedValue({ rulesets: [ruleset('2026-01-01')], unreadable: [], truncated: false })
    expect(await citationStylesFor('org_1', NOW)).toBe(FALLBACK_CITATION_STYLES)
    expect(readRulesetsInForce).toHaveBeenCalledWith('org_1', { purpose: 'citation_style', territoryIds: ['XA'] })
  })

  it('answers none before a style is in force, and for an office with no country', async () => {
    findOrganization.mockResolvedValue({ homeCountry: 'XA' })
    readRulesetsInForce.mockResolvedValue({ rulesets: [ruleset('2027-01-01')], unreadable: [], truncated: false })
    expect(await citationStylesFor('org_1', NOW)).toBeNull()
    findOrganization.mockResolvedValue({ homeCountry: null })
    expect(await citationStylesFor('org_1', NOW)).toBeNull()
  })
})
