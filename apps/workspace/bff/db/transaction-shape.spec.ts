// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { callsTo, parseSource, parseSourceText, productionSources, ts } from '@/test-utils/source-ast'

function getDbInsideTransaction(source: ts.SourceFile): ts.CallExpression[] {
  return callsTo(source, 'transaction').flatMap((transaction) =>
    transaction.arguments.flatMap((callback) => callsTo(callback, 'getDb')),
  )
}

describe('no getDb() inside a transaction body', () => {
  it('finds no call site that would need a second pool slot to finish its first', () => {
    const offenders = productionSources().filter((file) => getDbInsideTransaction(parseSource(file)).length > 0)

    expect(
      offenders,
      'These call getDb() inside a db.transaction() body. That needs a second ' +
        'pool slot while holding the first, and postgres-js has no acquisition ' +
        'timeout — on a saturated pool it deadlocks rather than erroring. Use the ' +
        '`tx` handle the callback receives.'
    ).toEqual([])
  })

  it('actually detects the shape it is looking for', () => {
    const flagged = parseSourceText(`
      await db.transaction(async (tx) => {
        const other = getDb()
        await other.select()
      })
    `)
    const clean = parseSourceText(`
      const other = getDb()
      await db.transaction(async (tx) => {
        await tx.select()
      })
    `)
    expect(getDbInsideTransaction(flagged)).toHaveLength(1)
    expect(getDbInsideTransaction(clean)).toEqual([])
  })
})
