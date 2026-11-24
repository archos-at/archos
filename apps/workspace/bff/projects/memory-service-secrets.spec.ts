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
import { BadRequestError } from '@/lib/api/errors'
import { embedNote } from '@/lib/knowledge/embeddings'
import { asDb } from '@/test-utils/db-fixtures'
import { createProjectMemoryItem, updateProjectMemoryItem } from './memory-service'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('a note never holds a secret, whichever door it came through', () => {
  const noDb = () => vi.mocked(getDb).mockReturnValue(asDb({}))

  it.each([
    ['a password', 'Projektserver-Zugang: Tulpe#4471!', 'a password or access code'],
    ['an API key', 'Planportal: sk-live-9f3a7c21d8e44b0aa1', 'an API key or access token'],
    ['a labelled login', 'Bauamt-Portal Login m.huber, Kennwort Sommer2024', 'a password or access code'],
  ])('refuses %s typed by a person, before anything is read or written', async (_what, content, named) => {
    noDb()
    const write = createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      provenanceType: 'user',
      content,
    })

    await expect(write).rejects.toBeInstanceOf(BadRequestError)
    await expect(write).rejects.toThrow(`A memory note cannot hold ${named}.`)
    expect(embedNote).not.toHaveBeenCalled()
  })

  it('refuses a secret in an edit', async () => {
    noDb()
    await expect(
      updateProjectMemoryItem({ organizationId: 'org-1' }, 'item-1', { content: 'WLAN-Passwort: Baustelle#7' })
    ).rejects.toThrow('A memory note cannot hold a password or access code.')
  })

  it('refuses a contact detail an agent writes to a shared shelf, and lets a person write one', async () => {
    noDb()
    const note = {
      scope: 'organization' as const,
      projectId: null,
      organizationId: 'org-1',
      kind: 'derived_fact' as const,
      content: 'Statiker Huber: +43 664 1234567',
    }
    await expect(createProjectMemoryItem({ ...note, provenanceType: 'agent' })).rejects.toThrow(
      'A note in shared memory cannot hold a phone number.'
    )
    await expect(createProjectMemoryItem({ ...note, provenanceType: 'distillation' })).rejects.toThrow(BadRequestError)
    await expect(createProjectMemoryItem({ ...note, provenanceType: 'user' })).rejects.not.toBeInstanceOf(BadRequestError)
  })
})
