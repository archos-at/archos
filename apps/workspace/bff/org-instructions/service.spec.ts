/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const findOrganizationInstructions = vi.fn()
const upsertOrganizationInstructions = vi.fn()
const deleteOrganizationInstructions = vi.fn()
vi.mock('./repository', () => ({
  findOrganizationInstructions: (...args: unknown[]) => findOrganizationInstructions(...args),
  upsertOrganizationInstructions: (...args: unknown[]) => upsertOrganizationInstructions(...args),
  deleteOrganizationInstructions: (...args: unknown[]) => deleteOrganizationInstructions(...args),
}))

const getCached = vi.fn()
const invalidateCached = vi.fn()
vi.mock('@/lib/cache', () => ({
  getCached: (...args: unknown[]) => getCached(...args),
  invalidateCached: (...args: unknown[]) => invalidateCached(...args),
}))

const recordAuditEvent = vi.fn()
vi.mock('@/lib/audit/service', () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_INSTRUCTIONS_MAX_CHARS } from './constants'
import {
  getOrgInstructions,
  orgInstructionsSchema,
  resolveOrgInstructions,
  saveOrgInstructions,
} from './service'

const SESSION = {
  userId: 'user-1',
  organizationId: 'org-1',
  email: 'admin@example.test',
} as AuthorizedSession

const request = (): Request => new Request('http://localhost/api/organization/instructions')

const row = (instructions: string) => ({
  organizationId: 'org-1',
  instructions,
  updatedBy: 'user-1',
  updatedByEmail: 'admin@example.test',
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

beforeEach(() => {
  vi.clearAllMocks()
  getCached.mockImplementation(async (_key: string, _ttl: number, load: () => Promise<unknown>) =>
    load()
  )
  findOrganizationInstructions.mockResolvedValue(null)
  upsertOrganizationInstructions.mockImplementation(async (values: { instructions: string }) =>
    row(values.instructions)
  )
  deleteOrganizationInstructions.mockResolvedValue(undefined)
})

describe('the write boundary', () => {
  it('accepts a block exactly at the cap', () => {
    const text = 'a'.repeat(ORG_INSTRUCTIONS_MAX_CHARS)
    expect(orgInstructionsSchema.safeParse({ instructions: text }).success).toBe(true)
  })

  it('refuses one character more, rather than truncating it', () => {
    const text = 'a'.repeat(ORG_INSTRUCTIONS_MAX_CHARS + 1)
    expect(orgInstructionsSchema.safeParse({ instructions: text }).success).toBe(false)
  })

  it('counts CHARACTERS, so an umlaut costs one', () => {
    const text = 'ä'.repeat(ORG_INSTRUCTIONS_MAX_CHARS)
    expect(orgInstructionsSchema.safeParse({ instructions: text }).success).toBe(true)
  })})

describe('saving', () => {
  it('stores the trimmed block and invalidates the turn path', async () => {
    const saved = await saveOrgInstructions(
      SESSION,
      { instructions: '  Lead with the verdict.  ' },
      request()
    )

    expect(upsertOrganizationInstructions).toHaveBeenCalledWith({
      organizationId: 'org-1',
      instructions: 'Lead with the verdict.',
      updatedBy: 'user-1',
      updatedByEmail: 'admin@example.test',
    })
    expect(saved.instructions).toBe('Lead with the verdict.')
    expect(invalidateCached).toHaveBeenCalledWith('orginstructions:org-1')
  })

  it('DELETES the row when the block is emptied, rather than storing nothing', async () => {
    const saved = await saveOrgInstructions(SESSION, { instructions: '   \n  ' }, request())

    expect(deleteOrganizationInstructions).toHaveBeenCalledWith('org-1')
    expect(upsertOrganizationInstructions).not.toHaveBeenCalled()
    expect(saved).toEqual({
      instructions: null,
      updatedBy: null,
      updatedByEmail: null,
      updatedAt: null,
    })
    expect(invalidateCached).toHaveBeenCalledWith('orginstructions:org-1')
  })

  it('records who wrote it, and whether they wrote or cleared', async () => {
    await saveOrgInstructions(SESSION, { instructions: 'Assume Vienna.' }, request())
    expect(recordAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        action: 'org.settings.updated',
        metadata: { fields: 'instructions' },
      })
    )

    await saveOrgInstructions(SESSION, { instructions: '' }, request())
    expect(recordAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: { fields: 'instructions:cleared' } })
    )
  })
})

describe('the turn path', () => {
  it('reads the block through a cache key that names the organization', async () => {
    findOrganizationInstructions.mockResolvedValue(row('Assume Vienna.'))

    expect(await resolveOrgInstructions('org-1')).toBe('Assume Vienna.')
    expect(getCached).toHaveBeenCalledWith('orginstructions:org-1', expect.any(Number), expect.any(Function))
  })

  it('reads null when the organization has written none', async () => {
    expect(await resolveOrgInstructions('org-1')).toBeNull()
  })

  it('reads null with no organization at all (anonymous deployments) and asks nothing', async () => {
    expect(await resolveOrgInstructions(null)).toBeNull()
    expect(getCached).not.toHaveBeenCalled()
  })

  it('fails SOFT: a broken read costs the turn its preferences, not the turn', async () => {
    getCached.mockRejectedValue(new Error('cache and database both down'))
    await expect(resolveOrgInstructions('org-1')).resolves.toBeNull()
  })
})

describe('the settings read', () => {
  it('carries who last wrote the block, as an ISO string', async () => {
    findOrganizationInstructions.mockResolvedValue(row('Assume Vienna.'))
    expect(await getOrgInstructions('org-1')).toEqual({
      instructions: 'Assume Vienna.',
      updatedBy: 'user-1',
      updatedByEmail: 'admin@example.test',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('answers the empty shape before the first save', async () => {
    expect(await getOrgInstructions('org-1')).toEqual({
      instructions: null,
      updatedBy: null,
      updatedByEmail: null,
      updatedAt: null,
    })
  })
})
