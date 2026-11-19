// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { withProductName } from '@/lib/brand'
import { en } from './dictionaries/en'
import { de } from './dictionaries/de'
import type { Namespace } from './namespace'
import { getByPath } from './translate'
import { nodesOf, parseSource, ts } from '@/test-utils/source-ast'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

const ROOT = process.cwd()

const TRANSLATOR_FACTORIES = new Set(['useTranslations', 'getTranslations', 'getStoreTranslator'])

function sourceFiles(): string[] {
  return srcEntries(ROOT).filter((key) => /\.tsx?$/.test(key) && !key.startsWith('i18n/'))
}

function translatorBindings(source: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const declaration of nodesOf(source, ts.isVariableDeclaration)) {
    const initializer = declaration.initializer
    const call = initializer && ts.isAwaitExpression(initializer) ? initializer.expression : initializer
    if (!ts.isIdentifier(declaration.name) || !call || !ts.isCallExpression(call)) continue
    if (!ts.isIdentifier(call.expression) || !TRANSLATOR_FACTORIES.has(call.expression.text)) continue
    const [copy, scope] = call.arguments
    if (!copy || !ts.isIdentifier(copy) || !/^\w+Copy$/.test(copy.text)) continue
    const namespace = copy.text.slice(0, -'Copy'.length)
    const scoped = scope && ts.isStringLiteral(scope) && scope.text !== '' ? `${namespace}.${scope.text}` : namespace
    bindings.set(declaration.name.text, scoped)
  }
  return bindings
}

function translatorCalls(source: ts.SourceFile, bindings: Map<string, string>) {
  return nodesOf(source, ts.isCallExpression).flatMap((call) => {
    if (!ts.isIdentifier(call.expression)) return []
    const namespace = bindings.get(call.expression.text)
    const [first] = call.arguments
    if (namespace === undefined || !first) return []
    return [{ namespace, first }]
  })
}

function referencedKeys(source: ts.SourceFile, bindings: Map<string, string>): string[] {
  return translatorCalls(source, bindings).flatMap(({ namespace, first }) =>
    ts.isStringLiteral(first) && first.text !== '' ? [`${namespace}.${first.text}`] : [],
  )
}

function referencedKeyPrefixes(source: ts.SourceFile, bindings: Map<string, string>): string[] {
  return translatorCalls(source, bindings).flatMap(({ namespace, first }) => {
    const text = ts.isNoSubstitutionTemplateLiteral(first)
      ? first.text
      : ts.isTemplateExpression(first)
        ? first.head.text
        : undefined
    const head = text?.replace(/\.$/, '')
    return head ? [`${namespace}.${head}`] : []
  })
}

const scanned = sourceFiles().map((file) => {
  const source = parseSource(srcPath(file, ROOT))
  const bindings = translatorBindings(source)
  return {
    file,
    keys: referencedKeys(source, bindings),
    prefixes: referencedKeyPrefixes(source, bindings),
  }
})
const keyRefs = scanned.flatMap(({ file, keys }) => keys.map((key) => ({ key, file })))
const prefixRefs = scanned.flatMap(({ file, prefixes }) => prefixes.map((prefix) => ({ prefix, file })))

describe('translation keys resolve against the dictionary', () => {
  const unresolved = keyRefs
    .filter(({ key }) => typeof getByPath(en, key) !== 'string')
    .map(({ key, file }) => `${key}  (${file})`)
  const danglingPrefixes = prefixRefs
    .filter(({ prefix }) => {
      const node = getByPath(en, prefix)
      return node === undefined || typeof node !== 'object'
    })
    .map(({ prefix, file }) => `${prefix}  (${file})`)

  it('every literal key a component asks for exists', () => {
    expect(
      unresolved.sort(),
      'These keys resolve to nothing, so the UI renders the literal dot-path. ' +
        'Fix the call site, or add the key to i18n/dictionaries/en (German ' +
        'follows by compile error).',
    ).toEqual([])
  })

  it('every computed key is rooted in a group that exists', () => {
    expect(
      danglingPrefixes.sort(),
      'The static head of a computed key names nothing, or names a single ' +
        'string rather than a group — so every value the suffix can take ' +
        'resolves to nothing.',
    ).toEqual([])
  })

  it('is actually looking at the call sites', () => {
    expect(keyRefs.length).toBeGreaterThan(1500)
    expect(prefixRefs.length).toBeGreaterThan(50)
  })
})

describe('every namespace has its module', () => {
  const modules = import.meta.glob<Record<string, Namespace>>('./namespaces/*.ts', { eager: true })
  const exported = Object.values(modules).flatMap((module) => Object.entries(module))

  it('exports one `<name>Copy` per namespace of the dictionary', () => {
    expect(exported.map(([binding, namespace]) => [binding, namespace.name]).sort()).toEqual(
      Object.keys(en).map((name) => [`${name}Copy`, name]).sort(),
    )
  })

  it('holds the same copy as the dictionary, in every locale', () => {
    for (const [, namespace] of exported) {
      const name = namespace.name as keyof typeof en
      expect(namespace.messages.en, name).toStrictEqual(withProductName(en[name]))
      expect(namespace.messages.de, name).toStrictEqual(withProductName(de[name]))
    }
  })
})
