// @disk-inputs: tests/fixtures/personal-shelf-collections.json
/**
 * @vitest-environment node
 *
 * The names the BFF gives a person's own shelf, as the agent must recognise
 * them (packages/agent/tests/knowledge/test_personal_shelf_contract.py reads
 * the same fixture).
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expectGenerated } from '@/test-utils/generated-file'
import { isPersonalShelfCollectionName, personalShelfCollectionName } from './collection'

const FIXTURE = join(process.cwd(), 'tests/fixtures/personal-shelf-collections.json')

const MEMBERS = [
  { organizationId: 'org_01HZX3K9QW8YB2C4D5E6F7G8H9', userId: 'user_01HZX3KA0B1C2D3E4F5G6H7J8K' },
  { organizationId: 'org_01JABCDEF0123456789ABCDEFG', userId: 'user_01JZZZZZZZZZZZZZZZZZZZZZZZ' },
]

describe('the personal shelf collection name across languages', () => {
  it('writes the names the agent must take for the owner’s shelf', () => {
    const collections = MEMBERS.map(({ organizationId, userId }) => personalShelfCollectionName(organizationId, userId))
    expect(collections.every(isPersonalShelfCollectionName)).toBe(true)
    expectGenerated(FIXTURE, `${JSON.stringify({ collections }, null, 2)}\n`)
  })
})
