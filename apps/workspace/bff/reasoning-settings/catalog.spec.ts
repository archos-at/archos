/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import catalogFixture from '../../tests/fixtures/reasoning_efforts_catalog.json'

import {
  REASONING_EFFORTS,
  isReasoningEffort,
  validateReasoningEffort,
} from './catalog'

describe('reasoning effort catalog', () => {
  it("exposes OpenRouter's unified levels, cheapest first", () => {
    expect(REASONING_EFFORTS).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
  })

  it('has a translated label for every level in both dictionaries', async () => {
    const [de, en] = await Promise.all([
      import('@/i18n/dictionaries/de/platform'),
      import('@/i18n/dictionaries/en/platform'),
    ])
    for (const dict of [de.platform, en.platform]) {
      const levels = dict.models.levels as Record<string, { label: string; hint: string }>
      expect(Object.keys(levels).sort()).toEqual([...REASONING_EFFORTS].sort())
      for (const effort of REASONING_EFFORTS) {
        expect(levels[effort].label).toBeTruthy()
        expect(levels[effort].hint).toBeTruthy()
      }
    }
  })

  it('rejects provider-native tier names', () => {
    expect(isReasoningEffort('max')).toBe(false)
    expect(validateReasoningEffort('max')).toMatch(/not a reasoning effort/)
    expect(validateReasoningEffort('MEDIUM')).toMatch(/not a reasoning effort/)
    expect(validateReasoningEffort(3)).toMatch(/not a reasoning effort/)
    expect(validateReasoningEffort(null)).toMatch(/not a reasoning effort/)
  })

  it('accepts every catalog level', () => {
    for (const effort of REASONING_EFFORTS) {
      expect(validateReasoningEffort(effort)).toBeNull()
    }
  })

  it('matches the cross-language contract fixture', () => {
    expect([...REASONING_EFFORTS]).toEqual(catalogFixture)
  })
})

describe('chat effort dial', () => {
  it('offers every unified level but none, cheapest first', async () => {
    const { CHAT_EFFORTS } = await import('./catalog')
    expect(CHAT_EFFORTS).toEqual(REASONING_EFFORTS.filter((effort) => effort !== 'none'))
  })

  it('reads the organization default and falls back on a stale value', async () => {
    const { chatEffortFromSettings } = await import('./catalog')
    expect(chatEffortFromSettings({ chatReasoningEffort: 'high' })).toBe('high')
    expect(chatEffortFromSettings({ chatReasoningEffort: 'none' })).toBe('medium')
    expect(chatEffortFromSettings({ chatReasoningEffort: 'max' })).toBe('medium')
    expect(chatEffortFromSettings({})).toBe('medium')
    expect(chatEffortFromSettings(null)).toBe('medium')
  })
})
