import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'


import { type SQL } from 'drizzle-orm'
import { REVIEWER_READER, SCREENED_ONLY, internalRead, memberReader } from './document-reader'
import { documentVisibleTo } from './visibility'

const dialect = new PgDialect()
const compiled = (clause: SQL | undefined) => (clause ? dialect.sqlToQuery(clause) : null)

describe('documentVisibleTo keeps everyone out of another person’s shelf (ADR-0193)', () => {
  it('lets a member read their own personal rows and no one else’s', () => {
    const query = compiled(documentVisibleTo(memberReader('u-me')))
    expect(query?.sql).toContain('"documents"."scope" <> $1 or "documents"."owner_user_id" = $2')
    expect(query?.params.slice(0, 2)).toEqual(['personal', 'u-me'])
  })

  it.each([
    ['a quarantine reviewer', REVIEWER_READER],
    ['a shared chat, which reads only what every reader may', SCREENED_ONLY],
  ])('gives %s no personal row at all', (_who, reader) => {
    const query = compiled(documentVisibleTo(reader))
    expect(query?.sql).toContain('"documents"."scope" <> $1')
    expect(query?.params[0]).toBe('personal')
  })

  it('leaves an internal read, which acts for the document and no reader, unfiltered', () => {
    expect(documentVisibleTo(internalRead('ingest'))).toBeUndefined()
  })
})
