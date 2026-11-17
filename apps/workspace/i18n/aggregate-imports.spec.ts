/**
 * @vitest-environment node
 */

import { readFileSync, globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ALLOWED: Record<string, string> = {
  'bff/navigation/describe-path.spec.ts':
    'checks that every label the path describer can return resolves, across the namespaces it names',
}

const AGGREGATE = /^import\s+(?!type\b)[^']*?from\s+'(?:@\/i18n|\.{1,2}(?:\/\.\.)*)\/dictionaries(?:\/(?:en|de))?'/m

describe('the aggregate dictionary', () => {
  it('is imported for its values only inside i18n', () => {
    const offenders = globSync('{src,tests}/**/*.{ts,tsx}')
      .filter((file) => !file.startsWith('i18n/') && !(file in ALLOWED))
      .filter((file) => AGGREGATE.test(readFileSync(file, 'utf8')))
    expect(
      offenders,
      "Import the namespace instead: `import { chatCopy } from '@/i18n/namespaces/chat'`, then " +
        "`useTranslations(chatCopy)`, `translatorFor(chatCopy, locale)` or `chatCopy.messages[locale]`.",
    ).toEqual([])
  })

  it('still catches a value import', () => {
    expect(AGGREGATE.test("import { en } from '@/i18n/dictionaries/en'")).toBe(true)
    expect(AGGREGATE.test("import { de, en } from '@/i18n/dictionaries'")).toBe(true)
    expect(AGGREGATE.test("import type { Dictionary } from '@/i18n/dictionaries'")).toBe(false)
    expect(AGGREGATE.test("import { chat } from '@/i18n/dictionaries/en/chat'")).toBe(false)
    expect(AGGREGATE.test("import { a } from './a'\nimport type { Dictionary } from '@/i18n/dictionaries'")).toBe(false)
  })
})
