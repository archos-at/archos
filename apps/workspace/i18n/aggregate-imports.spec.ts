/**
 * @vitest-environment node
 */

import { readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importsOf, parseSource, parseSourceText } from '@/test-utils/source-ast'

const SCANNED_DIRS = ['app', 'bff', 'shared', 'tests', 'types', 'ui', 'utils']
const SCRIPT_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']
const AGGREGATE_MODULES = new Set(['i18n/dictionaries', 'i18n/dictionaries/en', 'i18n/dictionaries/de'])

const ALLOWED: Record<string, string> = {
  'bff/navigation/describe-path': 'checks that every label the path describer can return resolves, across the namespaces it names',
}

function scriptFiles(): string[] {
  return SCANNED_DIRS.flatMap((dir) =>
    readdirSync(join(process.cwd(), dir), { recursive: true, encoding: 'utf8' })
      .map((entry) => `${dir}/${entry}`)
      .filter((file) => !file.split('/').includes('node_modules') && SCRIPT_EXTENSIONS.some((ext) => file.endsWith(`.${ext}`))),
  )
}

function isAllowed(file: string): boolean {
  return Object.keys(ALLOWED).some((stem) => file.startsWith(`${stem}.spec.`))
}

function importsAggregate(file: string, source: ReturnType<typeof parseSourceText>): boolean {
  return importsOf(source).some((edge) => {
    if (edge.typeOnly) return false
    const target = edge.specifier.startsWith('.')
      ? normalize(join(dirname(file), edge.specifier))
      : edge.specifier.replace(/^@\//, '')
    return AGGREGATE_MODULES.has(target)
  })
}

describe('the aggregate dictionary', () => {
  it('is imported for its values only inside i18n', () => {
    const offenders = scriptFiles()
      .filter((file) => !file.startsWith('i18n/') && !isAllowed(file))
      .filter((file) => importsAggregate(file, parseSource(file)))
    expect(
      offenders,
      "Import the namespace instead: `import { chatCopy } from '@/i18n/namespaces/chat'`, then " +
        "`useTranslations(chatCopy)`, `translatorFor(chatCopy, locale)` or `chatCopy.messages[locale]`.",
    ).toEqual([])
  }, 60_000)

  it('still catches a value import', () => {
    const catches = (text: string) => importsAggregate('bff/probe', parseSourceText(text, 'bff/probe'))
    expect(catches("import { en } from '@/i18n/dictionaries/en'")).toBe(true)
    expect(catches("import { de, en } from '@/i18n/dictionaries'")).toBe(true)
    expect(catches("import { de } from '../i18n/dictionaries/de'")).toBe(true)
    expect(catches("import type { Dictionary } from '@/i18n/dictionaries'")).toBe(false)
    expect(catches("import { chat } from '@/i18n/dictionaries/en/chat'")).toBe(false)
    expect(catches("import { a } from './a'\nimport type { Dictionary } from '@/i18n/dictionaries'")).toBe(false)
  })
})
