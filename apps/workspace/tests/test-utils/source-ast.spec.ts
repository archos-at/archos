/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { callsTo, exportedNames, importsOf, lineOf, parseSourceText, stringValues } from './source-ast'

const MODULE = `import 'server-only'
import type { A } from './a'
import { b, c as d } from '@/bff/b'
export { e } from './e'
// readFileSync('x.ts') in a comment is not a call
const lazy = () => import('./lazy')
export const one = 1
export function two() { return db.select('row') }
export type Three = string
select('top')
`

describe('source-ast', () => {
  const source = parseSourceText(MODULE, 'module.ts')

  it('lists imports, re-exports and dynamic imports with their names', () => {
    expect(importsOf(source).map(({ specifier, names, typeOnly }) => ({ specifier, names, typeOnly }))).toEqual([
      { specifier: 'server-only', names: [], typeOnly: false },
      { specifier: './a', names: ['A'], typeOnly: true },
      { specifier: '@/bff/b', names: ['b', 'c'], typeOnly: false },
      { specifier: './e', names: ['e'], typeOnly: false },
      { specifier: './lazy', names: ['*'], typeOnly: false },
    ])
  })

  it('finds calls by callee name, bare or as a method, and never inside a comment', () => {
    expect(callsTo(source, 'select').map(lineOf)).toEqual([8, 10])
    expect(callsTo(source, 'readFileSync')).toEqual([])
  })

  it('lists exported names', () => {
    expect(exportedNames(source)).toEqual(['e', 'one', 'two', 'Three'])
  })

  it('reads string values from code, not from comments', () => {
    expect(stringValues(source)).not.toContain('x.ts')
    expect(stringValues(source)).toContain('row')
  })
})
