/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ORG_INSTRUCTIONS_MAX_CHARS } from './constants'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const CHECK_VIOLATION = '23514'
const orgs = {
  cap: `org_instr_${STAMP}_cap`,
  over: `org_instr_${STAMP}_over`,
  umlaut: `org_instr_${STAMP}_umlaut`,
  blank: `org_instr_${STAMP}_blank`,
}

const refusedByCheck = (error: unknown): boolean =>
  (error as { cause?: { code?: string } }).cause?.code === CHECK_VIOLATION

describe.skipIf(!url)('the bound Postgres holds on organization_instructions', () => {
  let repository: typeof import('./repository')

  const write = (organizationId: string, instructions: string) =>
    repository.upsertOrganizationInstructions({
      organizationId,
      instructions,
      updatedBy: 'user-1',
      updatedByEmail: 'admin@example.test',
    })

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    repository = await import('./repository')
  })

  afterAll(async () => {
    for (const organizationId of Object.values(orgs)) {
      await repository.deleteOrganizationInstructions(organizationId)
    }
  })

  it('stores a block exactly at the cap', async () => {
    const text = 'a'.repeat(ORG_INSTRUCTIONS_MAX_CHARS)
    await write(orgs.cap, text)
    expect((await repository.findOrganizationInstructions(orgs.cap))?.instructions).toBe(text)
  })

  it('refuses one character more, and stores no truncated copy', async () => {
    await expect(write(orgs.over, 'a'.repeat(ORG_INSTRUCTIONS_MAX_CHARS + 1))).rejects.toSatisfy(refusedByCheck)
    expect(await repository.findOrganizationInstructions(orgs.over)).toBeNull()
  })

  it('counts CHARACTERS, so a cap of umlauts still fits', async () => {
    const text = 'ä'.repeat(ORG_INSTRUCTIONS_MAX_CHARS)
    await write(orgs.umlaut, text)
    expect((await repository.findOrganizationInstructions(orgs.umlaut))?.instructions).toBe(text)
  })

  it('refuses a blank block, because the row is deleted instead', async () => {
    await expect(write(orgs.blank, '   ')).rejects.toSatisfy(refusedByCheck)
    expect(await repository.findOrganizationInstructions(orgs.blank)).toBeNull()
  })
})
