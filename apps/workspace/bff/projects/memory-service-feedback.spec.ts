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
import { embedNote } from '@/lib/knowledge/embeddings'
import { asDb } from '@/test-utils/db-fixtures'
import { implicateMemoryFromFeedback } from './memory-service'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('implicateMemoryFromFeedback', () => {
  it('does nothing without an embedder — no penalty on a lexical-only deployment', async () => {
    const execute = vi.fn()
    vi.mocked(getDb).mockReturnValue(asDb({ execute }))
    const count = await implicateMemoryFromFeedback({
      organizationId: 'org-1',
      projectId: 'proj-1',
      comment: 'Die Antwort hat OIB 4 mit der Wiener BO vermischt.',
      readableFolderIds: [],
    })
    expect(count).toBe(0)
    expect(execute).not.toHaveBeenCalled()
  })

  it('penalizes the semantically implicated notes and reports how many', async () => {
    vi.mocked(embedNote).mockResolvedValue({ vector: [0.1, 0.2], fingerprint: 'model-a' })
    const execute = vi.fn(async () => [{ id: 'mem-1' }, { id: 'mem-2' }])
    vi.mocked(getDb).mockReturnValue(asDb({ execute }))
    const count = await implicateMemoryFromFeedback({
      organizationId: 'org-1',
      projectId: 'proj-1',
      comment: 'Die Antwort hat OIB 4 mit der Wiener BO vermischt.',
      readableFolderIds: [],
    })
    expect(count).toBe(2)
    expect(execute).toHaveBeenCalledTimes(1)
    const flat = JSON.stringify((execute.mock.calls as unknown[][])[0]?.[0])
    expect(flat).toContain('0.6')
    expect(flat).toContain('0.05')
    expect(flat).toContain('0.78')
    expect(flat).toContain('org-1')
  })

  it("implicates only notes the voter may see: open ones, and restricted ones they are cleared for (ADR-0087)", async () => {
    vi.mocked(embedNote).mockResolvedValue({ vector: [0.1, 0.2], fingerprint: 'model-a' })
    const execute = vi.fn(async () => [])
    vi.mocked(getDb).mockReturnValue(asDb({ execute }))

    await implicateMemoryFromFeedback({
      organizationId: 'org-1',
      projectId: 'proj-1',
      comment: 'Die Antwort war falsch.',
      readableFolderIds: [],
    })
    await implicateMemoryFromFeedback({
      organizationId: 'org-1',
      projectId: 'proj-1',
      comment: 'Die Antwort war falsch.',
      readableFolderIds: ['proj_x_rbbbbbbbbbbbb', 'proj_x_raaaaaaaaaaaa'],
    })

    const [uncleared, cleared] = (execute.mock.calls as unknown[][]).map((call) => JSON.stringify(call[0]))
    expect(uncleared).toContain('m.restricted_folder_ids is null')
    expect(uncleared).not.toContain('<@')
    expect(cleared).toContain('m.restricted_folder_ids <@ ')
    expect(cleared).toContain('{\\"proj_x_raaaaaaaaaaaa\\",\\"proj_x_rbbbbbbbbbbbb\\"}')
  })

  it('returns 0 for a blank comment and never throws on db failure', async () => {
    expect(
      await implicateMemoryFromFeedback({
        organizationId: 'org-1',
        projectId: null,
        comment: '   ',
        readableFolderIds: [],
      })
    ).toBe(0)
    vi.mocked(embedNote).mockResolvedValue({ vector: [0.1], fingerprint: 'model-a' })
    const execute = vi.fn(async () => {
      throw new Error('db down')
    })
    vi.mocked(getDb).mockReturnValue(asDb({ execute }))
    await expect(
      implicateMemoryFromFeedback({
        organizationId: 'org-1',
        projectId: null,
        comment: 'kaputt',
        readableFolderIds: [],
      })
    ).resolves.toBe(0)
  })
})
