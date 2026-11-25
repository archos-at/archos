/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { organizationCopy } from '@/i18n/namespaces/organization'
import { profileCopy } from '@/i18n/namespaces/profile'

describe('the account pages’ way back, which lands on /app (a chat where you last worked, #1923)', () => {
  it.each(['de', 'en'] as const)('%s: names the chat, never the projects list', (locale) => {
    for (const label of [profileCopy.messages[locale].backToApp, organizationCopy.messages[locale].backToApp]) {
      expect(label).toMatch(/chat/i)
      expect(label).not.toMatch(/projekt|project/i)
    }
  })
})
