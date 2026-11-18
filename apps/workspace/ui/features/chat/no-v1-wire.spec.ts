// @disk-inputs: ui/adapters/api/**, ui/features/chat/**
/**
 * @vitest-environment node
 */

import { describe, expect, test } from 'vitest'
import { nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const WIRE_PREFIXES = ['ui/features/chat/', 'ui/adapters/api/']

const V1_WIRE = new RegExp(['Function (Start|Complete)', '## Trace-Lanes', 'parseFunction' + 'Name'].join('|'))

const namesOrLiterals = (source: ts.SourceFile): Array<ts.Identifier | ts.StringLiteralLike> =>
  nodesOf(source, (n): n is ts.Identifier | ts.StringLiteralLike => ts.isIdentifier(n) || ts.isStringLiteralLike(n))

describe('no v1 wire reader in the chat or the socket adapter', () => {
  test('no file names a Function frame, a Trace-Lanes block or the function-name parser', () => {
    const offenders = productionSources()
      .filter((file) => WIRE_PREFIXES.some((prefix) => file.startsWith(prefix)))
      .filter((file) => namesOrLiterals(parseSource(file)).some((node) => V1_WIRE.test(node.text)))
    expect(offenders).toEqual([])
  })
})
