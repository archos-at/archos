/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { chatCopy } from '@/i18n/namespaces/chat'
import { getByPath } from '@/i18n/translate'
import { FORMULA_KEY_MAPS } from './formula-copy'

const keys = Object.entries(FORMULA_KEY_MAPS).flatMap(([map, entries]) =>
  Object.values(entries).map((key) => [map, key] as const)
)

describe('the formula card’s key maps', () => {
  it.each(keys)('%s → %s resolves in en and de', (_map, key) => {
    expect(typeof getByPath(chatCopy.messages.en, key), `en.chat.${key}`).toBe('string')
    expect(typeof getByPath(chatCopy.messages.de, key), `de.chat.${key}`).toBe('string')
  })
})
