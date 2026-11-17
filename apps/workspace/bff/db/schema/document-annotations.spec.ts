// @disk-inputs: migrations/0149_piloti_wakes_document_idx.down.sql, migrations/0149_piloti_wakes_document_idx.sql, migrations/0242_agent_actor_kind.down.sql, migrations/0242_agent_actor_kind.sql, migrations/meta/_journal.json
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig, IndexedColumn } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { documentAnnotations, pilotiWakes } from './document-annotations'
import { LEGACY_AGENT_KIND } from '@/lib/legacy-agent-kind'

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

describe('the actor kind of a mark, a reply and a proposal (migration 0242)', () => {
  it('the schema names the two constraints for the new value', () => {
    const checks = getTableConfig(documentAnnotations).checks.map((check) => check.name)
    expect(checks).toEqual(
      expect.arrayContaining(['document_annotations_only_agent_proposes', 'document_annotations_agent_needs_a_person'])
    )
  })

  it('the migration widens each CHECK that allowed the old value, and keeps the old value allowed', () => {
    const up = read('0242_agent_actor_kind.sql')
    expect(up).toContain(`CHECK ("author_kind" IN ('person', 'agent', '${LEGACY_AGENT_KIND}'))`)
    expect(up).toContain(`CHECK ("proposed_by_kind" IN ('${LEGACY_AGENT_KIND}', 'person', 'agent'))`)
    expect(up).toContain('document_annotations_only_agent_proposes')
    expect(up).toContain('document_annotations_agent_needs_a_person')
  })

  it('the migration rewrites no row: the writers keep the old value until the switch', () => {
    expect(read('0242_agent_actor_kind.sql')).not.toMatch(/\bUPDATE\s/)
  })

  it('the down migration moves the new value back and restores the narrower CHECK', () => {
    const down = read('0242_agent_actor_kind.down.sql')
    expect(down).toContain(`SET "author_kind" = '${LEGACY_AGENT_KIND}' WHERE "author_kind" = 'agent'`)
    expect(down).toContain(`CHECK ("author_kind" IN ('person', '${LEGACY_AGENT_KIND}'))`)
  })
})
