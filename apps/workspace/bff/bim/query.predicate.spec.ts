import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { buildBimPredicate, bimFilterSchema, bimQuerySchema } = await import('./query')

const dialect = new PgDialect()

function compile(
  filter: Parameters<typeof buildBimPredicate>[0],
  options?: Parameters<typeof buildBimPredicate>[1]
): { sql: string; params: unknown[] } {
  const predicate = buildBimPredicate(filter, options)
  if (!predicate) throw new Error('expected a predicate')
  const query = dialect.sqlToQuery(predicate)
  return { sql: query.sql, params: query.params }
}

const INDEXED = { searchKeysIndexed: true }

describe('the property-filter pre-filter', () => {
  it('never puts an unindexable IS NULL beside the containment', () => {
    const { sql } = compile(
      { properties: [{ name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }] },
      INDEXED
    )

    expect(sql).toContain('"search_keys" @>')
    expect(sql).not.toContain('"search_keys" is null')
    expect(sql).not.toContain('"search_keys" IS NULL')
  })

  it('looks up an exact string match by VALUE, lowercased, not just by key', () => {
    const { params } = compile(
      { properties: [{ set: 'Pset_WallCommon', name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }] },
      INDEXED
    )

    expect(params).toContain('{"p:pset_wallcommon.firerating":["rei 90"]}')
  })

  it('falls back to key existence when the value is not an exact string', () => {
    const { sql, params } = compile(
      { properties: [{ name: 'ThermalTransmittance', operator: 'lte', value: 0.2, source: 'property' }] },
      INDEXED
    )

    expect(sql).toContain('"search_keys" ?')
    expect(params).toContain('p:thermaltransmittance')
  })

  it('prefixes quantities separately from properties', () => {
    const { params } = compile(
      { properties: [{ name: 'Width', operator: 'exists', source: 'quantity' }] },
      INDEXED
    )

    expect(params).toContain('q:width')
  })

  it('leaves `missing` and `neq` alone', () => {
    for (const operator of ['missing', 'neq'] as const) {
      const { sql } = compile(
        { properties: [{ name: 'FireRating', operator, value: 'REI 90', source: 'property' }] },
        INDEXED
      )
      expect(sql, operator).not.toContain('search_keys')
    }
  })

  it('emits no pre-filter at all for a model that is not indexed', () => {
    const { sql } = compile(
      { properties: [{ name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }] },
      { searchKeysIndexed: false }
    )

    expect(sql).not.toContain('search_keys')
    expect(sql).toContain('jsonb_each')
  })

  it('defaults to no pre-filter when the caller does not say', () => {
    const { sql } = compile({
      properties: [{ name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }],
    })

    expect(sql).not.toContain('search_keys')
  })
})

describe('the query schema', () => {
  const filter = (value: unknown) => bimFilterSchema.safeParse(value)

  it('rejects a filter key it does not know instead of dropping it', () => {
    const result = filter({ ifcTypes: ['IfcWall'], storey: 'Erdgeschoss' })
    expect(result.success).toBe(false)
  })

  it('names the key it did not recognise, so the caller can correct it', () => {
    const result = filter({ ifcType: 'IfcWall' })
    expect(JSON.stringify(result.error?.issues)).toContain('ifcType')
  })

  it('still accepts every key it does know', () => {
    expect(
      filter({
        ifcTypes: ['IfcWall'],
        storeys: ['Erdgeschoss'],
        nameContains: 'Aussen',
        material: 'Beton',
        classification: 'Ifc',
        globalIds: ['abc'],
        properties: [{ set: 'Pset_WallCommon', name: 'FireRating', operator: 'exists' }],
      }).success
    ).toBe(true)
  })

  it('rejects a property filter with an invented field', () => {
    expect(filter({ properties: [{ property: 'FireRating', operator: 'exists' }] }).success).toBe(
      false
    )
  })

  it('refuses to group by a property without saying which', () => {
    const result = bimQuerySchema.safeParse({ op: 'aggregate', metric: 'count', groupBy: 'property' })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('groupProperty')
  })

  it('accepts the same grouping once the property is named', () => {
    expect(
      bimQuerySchema.safeParse({
        op: 'aggregate',
        metric: 'count',
        groupBy: 'property',
        groupProperty: { set: 'Pset_WallCommon', name: 'FireRating' },
      }).success
    ).toBe(true)
  })

  it('rejects an invented key at the TOP level too, not only inside the filter', () => {
    const result = bimQuerySchema.safeParse({
      op: 'aggregate',
      metric: 'count',
      filters: { ifcTypes: ['IfcWall'] },
    })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('filters')
  })

  it.each(['overview', 'health', 'schedule', 'types', 'profile'] as const)(
    'rejects a filter handed to %s, which reads the whole model',
    (op) => {
      expect(bimQuerySchema.safeParse({ op, filter: { ifcTypes: ['IfcWall'] } }).success).toBe(false)
    }
  )

  it('lets the viewer page past the extraction cap', () => {
    expect(bimQuerySchema.safeParse({ op: 'elements', offset: 150_000 }).success).toBe(true)
    expect(bimQuerySchema.safeParse({ op: 'elements', offset: 10_000_000 }).success).toBe(false)
  })
})

describe('what a property predicate compiles to', () => {
  it('escapes the ILIKE wildcards in a `contains` value', () => {
    const { params } = compile({ properties: [{ name: 'Raumnummer', operator: 'contains', value: 'WC_1', source: 'property' }] })
    expect(params).toContain('%WC\\_1%')
  })

  it('compares a numeric equality numerically, not as rendered text', () => {
    const { sql: text, params } = compile({
      properties: [{ name: 'Dicke', operator: 'eq', value: 0.0000001, source: 'property' }],
    })
    expect(text).toContain('::numeric')
    expect(params).toContain(0.0000001)
    expect(params).not.toContain('1e-7')
  })

  it('keeps a STRING equality case-insensitive and textual', () => {
    const { sql: text } = compile({
      properties: [{ name: 'FireRating', operator: 'eq', value: 'REI 90', source: 'property' }],
    })
    expect(text).toContain('lower(')
  })

  it('counts an element that does not carry the property as "not 2.5"', () => {
    const { sql: text } = compile({
      properties: [{ name: 'Dicke', operator: 'neq', value: 2.5, source: 'property' }],
    })
    expect(text).toContain('NOT (CASE WHEN')
  })
})
