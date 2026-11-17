// @disk-inputs: migrations/0149_piloti_wakes_document_idx.down.sql, migrations/0149_piloti_wakes_document_idx.sql, migrations/meta/_journal.json
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig, IndexedColumn } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { pilotiWakes } from './document-annotations'

const BUILT_AS = 'idx_piloti_wakes_document_annotation_created'
const NAME = 'idx_agent_wakes_document_annotation_created'
const read = (file: string) => readFileSync(join(process.cwd(), 'migrations', file), 'utf8')

describe('the index of a document’s wakes (migration 0149)', () => {
  it('is declared on the table: the document, then the mark, newest wake first', () => {
    const index = getTableConfig(pilotiWakes).indexes.find((entry) => entry.config.name === NAME)
    expect(index, `agent_wakes declares no ${NAME}`).toBeDefined()
    const columns = (index?.config.columns ?? []).map((column) =>
      column instanceof IndexedColumn ? `${column.name} ${column.indexConfig?.order ?? 'asc'}` : 'expression'
    )
    expect(columns).toEqual(['document_id asc', 'annotation_id asc', 'created_at desc'])
  })

  it('is built by the migration with the same columns, and the journal runs it', () => {
    expect(read('0149_piloti_wakes_document_idx.sql')).toMatch(
      new RegExp(`CREATE INDEX IF NOT EXISTS "${BUILT_AS}"\\s+ON "piloti_wakes" \\("document_id", "annotation_id", "created_at" DESC\\)`)
    )
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ tag: string }> }
    expect(journal.entries.map((entry) => entry.tag)).toContain('0149_piloti_wakes_document_idx')
  })

  it('is dropped on the way down', () => {
    expect(read('0149_piloti_wakes_document_idx.down.sql')).toContain(`DROP INDEX IF EXISTS "${BUILT_AS}"`)
  })
})
