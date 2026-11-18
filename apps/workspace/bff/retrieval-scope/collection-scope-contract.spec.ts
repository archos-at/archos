// @disk-inputs: ../../tests/fixtures/collection_scope/scope_header.json
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { encodeCollectionScopeHeader } from './collection-scope-request'
import type { ScopedCollection } from './collection-scope'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, '../../../../tests/fixtures/collection_scope/scope_header.json')

interface ScopeCase {
  name: string
  emittedByBff: boolean
  entries: Array<ScopedCollection | string>
  parsed: Array<{ collection: string; shelf: string | null }>
  header: string
}

const contract = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as {
  header_name: string
  cases: ScopeCase[]
}

describe('X-Grid-Collection-Scope — the shape the agent decodes', () => {
  const emitted = contract.cases.filter((entry) => entry.emittedByBff)

  test.each(emitted)('the BFF still encodes "$name" byte-for-byte', (scopeCase) => {
    const encoded = encodeCollectionScopeHeader(scopeCase.entries as ScopedCollection[])

    expect(encoded).toBe(scopeCase.header)
  })

  test.each(contract.cases)('"$name" round-trips back to its entries', (scopeCase) => {
    const decoded: unknown = JSON.parse(Buffer.from(scopeCase.header, 'base64url').toString('utf-8'))

    expect(decoded).toEqual(scopeCase.entries)
  })

  test('an unattributable collection omits the shelf rather than defaulting it', () => {
    const encoded = encodeCollectionScopeHeader([{ collection: 'some_custom_corpus' }])
    const [entry] = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as Array<
      Record<string, unknown>
    >

    expect(Object.keys(entry)).toEqual(['collection'])
  })

  test('a session collection is its own shelf, not project', () => {
    const encoded = encodeCollectionScopeHeader([{ collection: 's_conv_abc', shelf: 'session' }])
    const [entry] = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as Array<
      Record<string, unknown>
    >

    expect(entry.shelf).toBe('session')
  })

  test('the fixture covers every shelf, so a new one cannot be added silently', () => {
    const shelves = new Set(
      contract.cases
        .flatMap((scopeCase) => scopeCase.parsed)
        .map((entry) => entry.shelf)
        .filter((shelf): shelf is string => shelf !== null)
    )

    expect([...shelves].sort()).toEqual(['base', 'office_shelf', 'project', 'session'])
  })
})
