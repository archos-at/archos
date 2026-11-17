/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDocument } from '@/test-utils/db-fixtures'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import { AI_PROVENANCE_PROPERTIES } from '@/lib/ai-provenance'
import { PRODUCT_NAME } from '@/lib/brand'
import { s3Client } from '@/lib/s3'
import { assertWithinStorageQuota } from '@/lib/storage/service'
import { discardObject } from '@/lib/storage/discard'
import { getAccessibleDocument } from './access'
import { swapVersionContent } from './version-repository'
import { maySeeHeld } from '@/lib/upload-screening/quarantine-reviewers'
import {
  admitVersionBytes,
  newVersionWriteId,
  renderVersionBytes,
  versionMirrorsItem,
  versionWriteKey,
  writeVersionContent,
} from './version-content'
import { agentDocument, document, version } from './version-content.fixtures'

vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('./reingest', () => ({ cancelDocumentIngest: vi.fn() }))
vi.mock('./repository', () => ({ findDocumentInOrg: vi.fn(), markDocumentNotIndexed: vi.fn() }))
vi.mock('./version-repository', () => ({
  findDocumentVersion: vi.fn(),
  findDocumentVersionInOrg: vi.fn(),
  setDocumentLifecycle: vi.fn(),
  swapVersionContent: vi.fn(),
}))
vi.mock('@/lib/storage/discard', () => ({ discardObject: vi.fn() }))
vi.mock('@/lib/conversations/repository', () => ({ findConversationInOrg: vi.fn() }))
vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('@/lib/conversations/restricted-use', () => ({ admitRestrictedUse: vi.fn() }))
vi.mock('@/lib/projects/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/repository')>()),
  findProjectCollectionName: vi.fn(async () => 'proj_abc'),
}))
vi.mock('@/lib/organizations/service', () => ({
  getOrganizationDisplayName: vi.fn().mockResolvedValue('Büro Nord ZT GmbH'),
}))
vi.mock('@/lib/storage/service', () => ({
  assertWithinStorageQuota: vi.fn(),
  getStorageQuotaBytes: vi.fn().mockResolvedValue(10_000),
  STORAGE_QUOTA_EXCEEDED_MESSAGE: 'no storage space left',
}))
vi.mock('@/lib/storage/bucket', () => ({
  ensureTenantBucketChecked: vi.fn().mockResolvedValue('grid-org-1'),
  resolveDocumentBucket: () => 'grid-org-1',
}))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/download-log/service', () => ({ recordDocumentAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ maySeeHeld: vi.fn() }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('./collection-file-ref', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./collection-file-ref')>()),
  purgeIngestedChunks: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn() },
  bucketAdminS3Client: { send: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessibleDocument).mockResolvedValue(document)
  vi.mocked(maySeeHeld).mockResolvedValue(false)
})

describe('versionWriteKey', () => {
  it('gives every re-upload a directory of its own, even when the number reads 1', () => {
    expect(versionWriteKey('org/o/session/s_1/doc/d/plan.pdf', 1, 'a1b2c3d4e5f6')).toBe( // pragma: allowlist secret (a write-id fixture, not a credential)
      'org/o/session/s_1/doc/d/v1/a1b2c3d4e5f6/plan.pdf',
    )
  })

  it('never hands two overlapping re-uploads the same key, although both read the same number', () => {
    const base = 'org/o/project/p/doc/d/plan.pdf'
    const first = versionWriteKey(base, 3, newVersionWriteId())
    const second = versionWriteKey(base, 3, newVersionWriteId())
    expect(first).not.toBe(second)
    expect(first).toMatch(/\/doc\/d\/v3\/[0-9a-f]{12}\/plan\.pdf$/)
  })

  it('replaces an earlier version segment rather than nesting inside it', () => {
    expect(
      versionWriteKey('org/o/project/p/doc/d/v3/a1b2c3d4e5f6/plan.md', 5, 'ffffffffffff'),
    ).toBe('org/o/project/p/doc/d/v5/ffffffffffff/plan.md')
    expect(versionWriteKey('org/o/archiv/doc/d/v2/plan.md', 2, 'ffffffffffff')).toBe(
      'org/o/archiv/doc/d/v2/ffffffffffff/plan.md',
    )
  })

  it('has no version-1 shortcut: a rewrite of version 1 still gets its own object', () => {
    expect(versionWriteKey('org/o/session/s_1/doc/d/plan.md', 1, 'ffffffffffff')).toBe(
      'org/o/session/s_1/doc/d/v1/ffffffffffff/plan.md',
    )
  })

  it('still gives a key that predates the shelf layout a directory of its own', () => {
    expect(versionWriteKey('legacy/plan.md', 2, 'ffffffffffff')).toBe(
      'legacy/v2/ffffffffffff/plan.md',
    )
    expect(versionWriteKey('plan.md', 2, 'ffffffffffff')).toBe('v2/ffffffffffff/plan.md')
  })
})

describe('renderVersionBytes — the marking survives an update', () => {
  it('re-renders an agent document through its producer, marking and all', async () => {
    const rendered = await renderVersionBytes(agentDocument, version(), '# Aktenvermerk\n\nGK 4.')
    const text = rendered.bytes.toString('utf8')

    expect(text).toContain('# Aktenvermerk')
    expect(text).toContain(`${AI_PROVENANCE_PROPERTIES.generated}=true`)
    expect(text).toContain(`${AI_PROVENANCE_PROPERTIES.generator}=${PRODUCT_NAME}`)
    expect(rendered.contentType).toBe('text/markdown')
    expect(rendered.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('leaves a person’s own Markdown exactly as they wrote it', async () => {
    const rendered = await renderVersionBytes(document, version(), '# Von Hand\n')
    expect(rendered.bytes.toString('utf8')).toBe('# Von Hand\n')
  })
})

describe('admitVersionBytes', () => {
  const published = makeDocument({
    ...document,
    storageKey: 'org/org_1/project/proj_1/doc/doc_1/plan.md',
    publishedVersionId: 'ver_published',
  })

  it('charges a freshly forked draft the FULL size, because the published bytes stay', async () => {
    const fork = version({ id: 'ver_draft', storageKey: published.storageKey, fileSize: 1_000 })
    await admitVersionBytes('org_1', published, fork, 1_600)
    expect(assertWithinStorageQuota).toHaveBeenCalledWith('org_1', 1_600)
  })

  it('charges the DELTA for a draft that owns its previous object', async () => {
    const written = version({
      id: 'ver_draft',
      storageKey: 'org/org_1/project/proj_1/doc/doc_1/v2/aaaaaaaaaaaa/plan.md',
      fileSize: 1_000,
    })
    await admitVersionBytes('org_1', published, written, 1_600)
    expect(assertWithinStorageQuota).toHaveBeenCalledWith('org_1', 600)
  })

  it('charges the DELTA for the version that IS the item’s bytes', async () => {
    const item = makeDocument({ ...published, publishedVersionId: null })
    await admitVersionBytes(
      'org_1',
      item,
      version({ versionNumber: 1, storageKey: item.storageKey, fileSize: 1_000 }),
      1_600,
    )
    expect(assertWithinStorageQuota).toHaveBeenCalledWith('org_1', 600)
  })

  it('asks nothing when a draft of its own shrinks', async () => {
    await admitVersionBytes(
      'org_1',
      published,
      version({ id: 'ver_draft', storageKey: 'k/own', fileSize: 1_000 }),
      400,
    )
    expect(assertWithinStorageQuota).not.toHaveBeenCalled()
  })

  it('lets a refusal through, so nothing is written or swapped', async () => {
    vi.mocked(assertWithinStorageQuota).mockRejectedValueOnce(new Error('no room'))
    await expect(admitVersionBytes('org_1', published, version(), 10_000)).rejects.toThrow(
      /no room/,
    )
  })
})

describe('writeVersionContent — one object per write, swapped only if unchanged', () => {
  const rendered = {
    bytes: Buffer.from('# neu', 'utf8'),
    contentType: 'text/markdown',
    contentHash: 'sha256:neu',
  }
  const draftKey = 'org/org_1/project/proj_1/doc/doc_1/v2/aaaaaaaaaaaa/plan.md'
  const read = version({
    id: 'ver_draft',
    versionNumber: 2,
    storageKey: draftKey,
    contentHash: 'sha256:alt',
  })
  const item = makeDocument({
    ...agentDocument,
    storageKey: 'org/org_1/project/proj_1/doc/doc_1/plan.md',
    publishedVersionId: 'ver_published',
  })

  function putKeys(): string[] {
    return vi
      .mocked(s3Client.send)
      .mock.calls.map(([command]) => (command as unknown as { input: { Key: string } }).input.Key)
  }

  beforeEach(() => {
    vi.mocked(swapVersionContent).mockImplementation(async (input) => ({
      ok: true,
      version: { ...read, ...input.patch } as DocumentVersion,
      previousKeyOrphaned: true,
    }))
  })

  it('stores the bytes under a fresh key BEFORE the swap, and swaps on what it read', async () => {
    const order: string[] = []
    vi.mocked(s3Client.send).mockImplementation(async () => {
      order.push('put')
      return {}
    })
    vi.mocked(swapVersionContent).mockImplementationOnce(async (input) => {
      order.push('swap')
      return { ok: true, version: { ...read, ...input.patch } as DocumentVersion, previousKeyOrphaned: false }
    })

    const swapped = await writeVersionContent({
      organizationId: 'org_1',
      document: item,
      version: read,
      rendered,
      stamp: { state: 'draft' },
    })

    expect(order).toEqual(['put', 'swap'])
    const [written] = putKeys()
    expect(written).toMatch(/\/doc\/doc_1\/v2\/[0-9a-f]{12}\/plan\.md$/)
    expect(written).not.toBe(draftKey)
    expect(swapVersionContent).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: 'ver_draft',
        expected: { state: 'draft', storageKey: draftKey, contentHash: 'sha256:alt' },
        patch: expect.objectContaining({
          state: 'draft',
          storageKey: written,
          contentHash: 'sha256:neu',
          fileSize: 5,
        }),
        mirrorsItem: false,
      }),
    )
    expect(swapped.storageKey).toBe(written)
  })

  it('never writes two concurrent replaces to one key', async () => {
    const input = { organizationId: 'org_1', document: item, version: read, rendered, stamp: {} }
    await Promise.all([writeVersionContent(input), writeVersionContent(input)])
    const [first, second] = putKeys()
    expect(first).not.toBe(second)
  })

  it('answers the loser with 409 and deletes the object it wrote — never the winner’s', async () => {
    vi.mocked(swapVersionContent).mockResolvedValueOnce({ ok: false, reason: 'conflict' })

    await expect(
      writeVersionContent({ organizationId: 'org_1', document: item, version: read, rendered, stamp: {} }),
    ).rejects.toMatchObject({ status: 409 })

    const [written] = putKeys()
    expect(discardObject).toHaveBeenCalledTimes(1)
    expect(discardObject).toHaveBeenCalledWith('grid-org-1', written)
  })

  it('deletes the object it wrote when the swap itself fails', async () => {
    vi.mocked(swapVersionContent).mockRejectedValueOnce(new Error('connection reset'))
    await expect(
      writeVersionContent({ organizationId: 'org_1', document: item, version: read, rendered, stamp: {} }),
    ).rejects.toThrow('connection reset')
    expect(discardObject).toHaveBeenCalledWith('grid-org-1', putKeys()[0])
  })

  it('deletes the draft’s previous object once nothing names it', async () => {
    await writeVersionContent({ organizationId: 'org_1', document: item, version: read, rendered, stamp: {} })
    expect(discardObject).toHaveBeenCalledWith('grid-org-1', draftKey)
  })

  it('leaves a shared previous object alone — a fresh fork still carries the published key', async () => {
    vi.mocked(swapVersionContent).mockImplementationOnce(async (input) => ({
      ok: true,
      version: { ...read, ...input.patch } as DocumentVersion,
      previousKeyOrphaned: false,
    }))
    await writeVersionContent({
      organizationId: 'org_1',
      document: item,
      version: { ...read, storageKey: item.storageKey },
      rendered,
      stamp: {},
    })
    expect(discardObject).not.toHaveBeenCalled()
  })

  it('mirrors onto the item when the version IS the item’s bytes', async () => {
    await writeVersionContent({
      organizationId: 'org_1',
      document: makeDocument({ ...agentDocument, publishedVersionId: null }),
      version: version({ versionNumber: 1 }),
      rendered,
      stamp: {},
    })
    expect(swapVersionContent).toHaveBeenCalledWith(expect.objectContaining({ mirrorsItem: true }))
  })

  it('hands the swap the organization’s quota, so the ceiling is held under the lock', async () => {
    await writeVersionContent({ organizationId: 'org_1', document: item, version: read, rendered, stamp: {} })
    expect(swapVersionContent).toHaveBeenCalledWith(expect.objectContaining({ quotaBytes: 10_000 }))
  })

  it('takes its object back and answers 507 when the locked admission refuses', async () => {
    vi.mocked(swapVersionContent).mockResolvedValueOnce({
      ok: false,
      reason: 'quota',
      usedBytes: 9_999,
    })

    await expect(
      writeVersionContent({ organizationId: 'org_1', document: item, version: read, rendered, stamp: {} }),
    ).rejects.toMatchObject({ status: 507 })
    expect(discardObject).toHaveBeenCalledWith('grid-org-1', putKeys()[0])
    expect(discardObject).toHaveBeenCalledTimes(1)
  })

  it('writes and swaps nothing when the quota courtesy check refuses', async () => {
    vi.mocked(assertWithinStorageQuota).mockRejectedValueOnce(new Error('no room'))
    await expect(
      writeVersionContent({
        organizationId: 'org_1',
        document: item,
        version: { ...read, fileSize: 1 },
        rendered: { ...rendered, bytes: Buffer.alloc(10_000) },
        stamp: {},
      }),
    ).rejects.toThrow(/no room/)
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(swapVersionContent).not.toHaveBeenCalled()
  })
})

describe('versionMirrorsItem', () => {
  it('is the published pointer whenever there is one', () => {
    const doc = makeDocument({ ...document, publishedVersionId: 'ver_live' })
    expect(versionMirrorsItem(doc, version({ id: 'ver_live' }))).toBe(true)
    expect(versionMirrorsItem(doc, version({ id: 'ver_draft', versionNumber: 1 }))).toBe(false)
  })

  it('is version 1 before anything has been published', () => {
    const doc = makeDocument({ ...document, publishedVersionId: null })
    expect(versionMirrorsItem(doc, version({ versionNumber: 1 }))).toBe(true)
    expect(versionMirrorsItem(doc, version({ versionNumber: 2 }))).toBe(false)
  })
})
