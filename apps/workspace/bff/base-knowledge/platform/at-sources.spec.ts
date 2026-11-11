// @disk-inputs: ../../configs/knowledge-packs/at-sources.json
/**
 * @vitest-environment node
 *
 * The source records Austria's change request proposes (`configs/knowledge-packs/at-sources.json`, written by
 * `scripts/source_record_payload.py`) are records the door takes as they are: no hand edit between the file
 * and `records-propose`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { proposeRecordsBodySchema } = await import('./wire')

const payload = JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', 'at-sources.json'), 'utf8')) as {
  countryId: string
  records: unknown[]
}

describe('Austria’s source records, as the door takes them', () => {
  it('parse as a records-propose body, the lookup block with them', () => {
    const parsed = proposeRecordsBodySchema.parse({ records: payload.records })
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({ type: 'source', territoryId: payload.countryId, lookup: { language: 'de' } })
  })
})
