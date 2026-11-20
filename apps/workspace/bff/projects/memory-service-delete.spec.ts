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
import { asDb } from '@/test-utils/db-fixtures'
import { deleteProjectMemoryItem } from './memory-service'
import { and, eq, openOnly } from './memory-service.fixtures'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('deleteProjectMemoryItem tenancy guard', () => {
  const mockDeleteChain = (rows: unknown[]) => {
    const returning = vi.fn().mockResolvedValue(rows)
    const where = vi.fn().mockReturnValue({ returning })
    vi.mocked(getDb).mockReturnValue(asDb({ delete: vi.fn().mockReturnValue({ where }) }))
    return { where }
  }

  it('org owner cannot delete a project-scoped or foreign-org item', async () => {
    const { where } = mockDeleteChain([])

    const deleted = await deleteProjectMemoryItem({ organizationId: 'org-1' }, 'item-1')

    expect(deleted).toBe(false)
    expect(where).toHaveBeenCalledWith(
      and(
        eq('pm.id', 'item-1'),
        and(eq('pm.scope', 'organization'), eq('pm.organizationId', 'org-1'), openOnly)
      )
    )
  })

  it('project owner deletion is scoped to the project and to what the owner may see', async () => {
    const { where } = mockDeleteChain([{ id: 'item-1' }])

    const deleted = await deleteProjectMemoryItem(
      { projectId: 'proj-1', organizationId: 'org-1', readableFolderIds: [] },
      'item-1'
    )

    expect(deleted).toBe(true)
    expect(where).toHaveBeenCalledWith(
      and(eq('pm.id', 'item-1'), and(eq('pm.projectId', 'proj-1'), openOnly))
    )
  })
})
