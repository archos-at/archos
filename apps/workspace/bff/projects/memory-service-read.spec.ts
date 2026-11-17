/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, values: unknown[]) => ({ op: 'inArray', col, values }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  or: (...conditions: unknown[]) => ({ op: 'or', conditions }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    strings: Array.from(strings),
    values,
  }),
}))

vi.mock('@/lib/db/schema/project-memory', () => ({
  PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS: 20,
  projectMemory: {
    id: 'pm.id',
    scope: 'pm.scope',
    projectId: 'pm.projectId',
    organizationId: 'pm.organizationId',
    kind: 'pm.kind',
    content: 'pm.content',
    status: 'pm.status',
    confidence: 'pm.confidence',
    verification: 'pm.verification',
    pinned: 'pm.pinned',
    updatedAt: 'pm.updatedAt',
    restrictedFolderIds: 'pm.restrictedFolderIds',
  },
}))

vi.mock('@/lib/db/schema/projects', () => ({
  projects: {
    id: 'p.id',
    organizationId: 'p.organizationId',
    collectionName: 'p.collectionName',
  },
}))

vi.mock('@/lib/authz/folder-access', () => ({
  sourceFoldersOfCollections: vi.fn(async () => new Map<string, string>()),
}))

vi.mock('@/lib/knowledge/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/embeddings')>()
  return { ...actual, embedNote: vi.fn(async () => null), embedNotes: vi.fn(async () => null) }
})

vi.mock('@/lib/upload-screening/service', async () => {
  const { chatScreeningRules, maskText } = await import('@/lib/upload-screening/content-screen')
  const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
  return {
    maskChatText: vi.fn(async (_organizationId: string, text: string) =>
      maskText(text, chatScreeningRules(SUGGESTED_SCREENING_POLICY))
    ),
  }
})

import { getDb } from '@/lib/db'
import { mockSelectChain } from './memory-service-db.fixtures'
import { listProjectMemory, memoryVisibleTo, organizationExists } from './memory-service'
import { and, eq, isNull, openOnly, or } from './memory-service.fixtures'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('listProjectMemory', () => {
  it('pins the project branch to the org and merges org-wide items when an org is known', async () => {
    const { where } = mockSelectChain([])

    await listProjectMemory('proj-1', { organizationId: 'org-1' })

    expect(where).toHaveBeenCalledWith(
      and(
        or(
          and(eq('pm.projectId', 'proj-1'), eq('pm.organizationId', 'org-1')),
          and(
            eq('pm.scope', 'organization'),
            eq('pm.organizationId', 'org-1'),
            isNull('pm.projectId')
          )
        ),
        eq('pm.status', 'active'),
        openOnly
      )
    )
  })

  it('falls back to project-only filtering without an org (anonymous mode)', async () => {
    const { where } = mockSelectChain([])

    await listProjectMemory('proj-1')

    expect(where).toHaveBeenCalledWith(
      and(eq('pm.projectId', 'proj-1'), eq('pm.status', 'active'), openOnly)
    )
  })

  it('lists a restricted item only for a reader cleared for all of it (ADR-0087)', async () => {
    const { where } = mockSelectChain([])

    await listProjectMemory('proj-1', { readableFolderIds: ['proj_x_raaaaaaaaaaaa'] })

    expect(where).toHaveBeenCalledWith(
      and(
        eq('pm.projectId', 'proj-1'),
        eq('pm.status', 'active'),
        memoryVisibleTo(['proj_x_raaaaaaaaaaaa'])
      )
    )
  })
})

describe('organizationExists', () => {
  it('is true when at least one project belongs to the org', async () => {
    const { where } = mockSelectChain([{ id: 'proj-1' }])
    await expect(organizationExists('org-1')).resolves.toBe(true)
    expect(where).toHaveBeenCalledWith(eq('p.organizationId', 'org-1'))
  })

  it('is false for an unknown org', async () => {
    mockSelectChain([])
    await expect(organizationExists('org-nope')).resolves.toBe(false)
  })
})
