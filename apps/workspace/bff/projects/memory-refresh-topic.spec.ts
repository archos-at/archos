/**
 * @vitest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { restatedTopicSet } from './memory-refresh-topic'

/** The SQL a refresh's `.set({ topic })` runs, as the database receives it. */
function rendered(topic: string | null | undefined) {
  const fill = restatedTopicSet(topic).topic
  return fill ? new PgDialect().sqlToQuery(fill) : null
}

describe('restatedTopicSet', () => {
  it('sets nothing when the restating write names no topic', () => {
    expect(restatedTopicSet(undefined)).toEqual({})
    expect(restatedTopicSet(null)).toEqual({})
    expect(restatedTopicSet('')).toEqual({})
  })

  it('files the note under the topic the write names, as one bound value', () => {
    expect(rendered('Brandschutz')).toMatchObject({
      sql: 'coalesce("project_memory"."topic", $1)',
      params: ['Brandschutz'],
    })
  })

  it('keeps the topic the note already holds: the column is the first argument, so it wins', () => {
    const query = rendered('Stellplätze')
    expect(query?.sql.startsWith('coalesce("project_memory"."topic", ')).toBe(true)
  })
})
