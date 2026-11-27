/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import { memberReader } from './document-reader'
import type { RevisionLinkNames } from './revision-links'
import type { RevisionLinksSubject } from './revision-links-loader'

vi.mock('@/lib/authz/folder-access', () => ({ getHiddenFolderIds: vi.fn() }))
vi.mock('./reconcile-status', () => ({ readRevisionLinkNames: vi.fn(), refreshCollectionFiles: vi.fn() }))
vi.mock('./repository', () => ({ findRevisionCounterparts: vi.fn() }))

import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { loadRevisionLinks } from './revision-links-loader'
import { readRevisionLinkNames, refreshCollectionFiles } from './reconcile-status'
import { findRevisionCounterparts } from './repository'

const session = { userId: 'user-1', organizationId: 'org-1' } as AuthorizedSession
const reader = memberReader('user-1')

const subject = (overrides: Partial<RevisionLinksSubject> = {}): RevisionLinksSubject => ({
  id: 'doc-b',
  filename: 'Grundriss_B.pdf',
  collectionName: 'proj_abc',
  authoredBy: 'user',
  authoredByProducer: null,
  publishedVersionId: null,
  ...overrides,
})

const names = (overrides: Partial<RevisionLinkNames> = {}): RevisionLinkNames => ({
  supersededBy: null,
  supersedes: [],
  suggestion: null,
  change: null,
  ...overrides,
})

const A = { id: 'doc-a', filename: 'Grundriss_A.pdf', projectId: 'p1', folderId: null, createdAt: new Date('2026-07-02T09:00:00Z') }
const HELD = 'Gehaltsliste_intern.xlsx'

describe('loadRevisionLinks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getHiddenFolderIds).mockResolvedValue([])
    vi.mocked(findRevisionCounterparts).mockResolvedValue([])
  })

  it('resolves the names of one collection to the documents the reader may see', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersedes: [A.filename] }))
    vi.mocked(findRevisionCounterparts).mockResolvedValue([A])

    const facts = await loadRevisionLinks(session, [subject()], reader)

    expect(facts.get('doc-b')?.supersedes).toEqual([{ id: 'doc-a', filename: 'Grundriss_A.pdf' }])
    expect(findRevisionCounterparts).toHaveBeenCalledWith('org-1', 'proj_abc', [A.filename], reader)
  })

  it('never surfaces the name of a document the visibility query did not return (held, archived, deleted)', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(
      names({
        supersededBy: HELD,
        supersedes: [HELD, A.filename],
        suggestion: { of: HELD, confidence: 0.9, reason: `Neuer als ${HELD}`, basis: 'name' },
        change: { text: `Gegenüber ${HELD}: Spalte C entfällt.`, basis: HELD },
      }),
    )
    vi.mocked(findRevisionCounterparts).mockResolvedValue([A])

    const facts = await loadRevisionLinks(session, [subject()], reader)

    const projected = JSON.stringify([...facts.values()])
    expect(projected).not.toContain(HELD)
    expect(projected).not.toContain('Gehalt')
    expect(facts.get('doc-b')).toEqual({
      supersededBy: null,
      supersedes: [{ id: 'doc-a', filename: 'Grundriss_A.pdf' }],
      suggestion: null,
      changeSummary: null,
      history: [{ id: 'doc-a', filename: 'Grundriss_A.pdf', createdAt: '2026-07-02T09:00:00.000Z', changeSummary: null }],
    })
  })

  describe('two documents of one name in different folders', () => {
    const DRAFT = { id: '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f', filename: 'Plan.pdf', projectId: 'p1', folderId: 'folder-entwurf', createdAt: null }
    const SUBMISSION = { id: '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30', filename: 'Plan.pdf', projectId: 'p1', folderId: 'folder-einreichung', createdAt: null }
    const submission = subject({ id: SUBMISSION.id, filename: 'Plan.pdf' })

    it('resolves a link the listing names by id to that document, not to the same-named one', async () => {
      vi.mocked(readRevisionLinkNames).mockImplementation(async (ref) =>
        ref.documentId === SUBMISSION.id ? names({ supersedes: [DRAFT.id] }) : null,
      )
      vi.mocked(findRevisionCounterparts).mockResolvedValue([DRAFT, SUBMISSION])

      const facts = await loadRevisionLinks(session, [submission], reader)

      expect(facts.get(SUBMISSION.id)?.supersedes).toEqual([{ id: DRAFT.id, filename: 'Plan.pdf' }])
      expect(findRevisionCounterparts).toHaveBeenCalledWith('org-1', 'proj_abc', [DRAFT.id], reader)
    })

    it('treats its own id as itself: a document never supersedes or is superseded by itself', async () => {
      vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersededBy: SUBMISSION.id, change: { text: 'Neu.', basis: SUBMISSION.id } }))
      vi.mocked(findRevisionCounterparts).mockResolvedValue([DRAFT, SUBMISSION])

      const facts = await loadRevisionLinks(session, [submission], reader)

      expect(facts.get(SUBMISSION.id)).toEqual({ supersededBy: null, supersedes: [], suggestion: null, changeSummary: { text: 'Neu.', basis: 'previous' } })
    })

    it('resolves a name two documents carry to neither, rather than guessing', async () => {
      const bestand = subject({ id: 'doc-bestand', filename: 'Bestand.pdf' })
      vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersededBy: 'Plan.pdf' }))
      vi.mocked(findRevisionCounterparts).mockResolvedValue([DRAFT, SUBMISSION])

      expect((await loadRevisionLinks(session, [bestand], reader)).size).toBe(0)
    })

    it('still resolves a name only one document carries, for a link stored before links carried ids', async () => {
      const bestand = subject({ id: 'doc-bestand', filename: 'Bestand.pdf' })
      vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersededBy: 'Plan.pdf' }))
      vi.mocked(findRevisionCounterparts).mockResolvedValue([DRAFT])

      expect((await loadRevisionLinks(session, [bestand], reader)).get('doc-bestand')?.supersededBy).toEqual({
        id: DRAFT.id,
        filename: 'Plan.pdf',
      })
    })
  })

  it('has no entry when everything a document refers to is hidden', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersededBy: HELD }))

    const facts = await loadRevisionLinks(session, [subject()], reader)

    expect(facts.size).toBe(0)
  })

  it('drops a document in a folder the session may not open (ADR-0087), the Papierkorb included', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersedes: [A.filename] }))
    vi.mocked(findRevisionCounterparts).mockResolvedValue([{ ...A, folderId: 'folder-closed' }])
    vi.mocked(getHiddenFolderIds).mockResolvedValue(['folder-closed'])

    const facts = await loadRevisionLinks(session, [subject()], reader)

    expect(getHiddenFolderIds).toHaveBeenCalledWith(session, 'p1')
    expect(facts.size).toBe(0)
  })

  it('keeps a document in a folder the session may open', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersedes: [A.filename] }))
    vi.mocked(findRevisionCounterparts).mockResolvedValue([{ ...A, folderId: 'folder-open' }])
    vi.mocked(getHiddenFolderIds).mockResolvedValue(['folder-closed'])

    expect((await loadRevisionLinks(session, [subject()], reader)).get('doc-b')?.supersedes).toHaveLength(1)
  })

  it('asks nothing of the database when no document names another', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ change: { text: 'Neu', basis: 'Grundriss_B.pdf' } }))

    const facts = await loadRevisionLinks(session, [subject()], reader)

    expect(findRevisionCounterparts).not.toHaveBeenCalled()
    expect(facts.get('doc-b')?.changeSummary).toEqual({ text: 'Neu', basis: 'previous' })
  })

  it('reads a machine-authored row for nothing, whatever the listing holds under its name', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(names({ supersedes: [A.filename] }))

    const facts = await loadRevisionLinks(session, [subject({ authoredBy: 'agent', publishedVersionId: null })], reader)

    expect(readRevisionLinkNames).not.toHaveBeenCalled()
    expect(facts.size).toBe(0)
  })

  it('resolves each collection against its own documents', async () => {
    vi.mocked(readRevisionLinkNames).mockImplementation(async (ref) =>
      names({ supersedes: [ref.collectionName === 'proj_abc' ? 'Grundriss_A.pdf' : 'Schnitt_A.pdf'] }),
    )
    vi.mocked(findRevisionCounterparts).mockImplementation(async (_org, collection) =>
      collection === 'proj_abc' ? [A] : [{ id: 'doc-s', filename: 'Schnitt_A.pdf', projectId: 'p2', folderId: null, createdAt: null }],
    )

    const facts = await loadRevisionLinks(
      session,
      [subject(), subject({ id: 'doc-t', filename: 'Schnitt_B.pdf', collectionName: 'proj_xyz' })],
      reader,
    )

    expect(facts.get('doc-b')?.supersedes[0].id).toBe('doc-a')
    expect(facts.get('doc-t')?.supersedes[0].id).toBe('doc-s')
  })

  it('refreshes each collection once before it reads, when asked', async () => {
    vi.mocked(readRevisionLinkNames).mockResolvedValue(null)

    await loadRevisionLinks(session, [subject(), subject({ id: 'doc-a', filename: 'Grundriss_A.pdf' })], reader, {
      fresh: true,
    })

    expect(refreshCollectionFiles).toHaveBeenCalledTimes(1)
    expect(refreshCollectionFiles).toHaveBeenCalledWith('proj_abc')
  })

  describe('the history', () => {
    const C = { id: 'doc-c', filename: 'Grundriss_C.pdf', projectId: 'p1', folderId: null, createdAt: new Date('2026-08-14T09:00:00Z') }
    const B = { id: 'doc-b2', filename: 'Grundriss_B.pdf', projectId: 'p1', folderId: null, createdAt: new Date('2026-07-30T09:00:00Z') }
    const byName: Record<string, RevisionLinkNames> = {
      'Grundriss_C.pdf': names({ supersedes: ['Grundriss_B.pdf'], change: { text: '- Zufahrt neu', basis: 'Grundriss_B.pdf' } }),
      'Grundriss_B.pdf': names({ supersededBy: 'Grundriss_C.pdf', supersedes: ['Grundriss_A.pdf'], change: { text: '- Stiege verschoben', basis: 'Grundriss_A.pdf' } }),
      'Grundriss_A.pdf': names({ supersededBy: 'Grundriss_B.pdf' }),
    }

    it('lists every older Fassung, newest first, each with its own change line', async () => {
      vi.mocked(readRevisionLinkNames).mockImplementation(async (ref) => byName[ref.filename] ?? null)
      vi.mocked(findRevisionCounterparts).mockResolvedValue([A, B, C])

      const facts = await loadRevisionLinks(session, [subject({ id: 'doc-c', filename: 'Grundriss_C.pdf' })], reader)

      expect(facts.get('doc-c')?.history).toEqual([
        { id: 'doc-b2', filename: 'Grundriss_B.pdf', createdAt: '2026-07-30T09:00:00.000Z', changeSummary: '- Stiege verschoben' },
        { id: 'doc-a', filename: 'Grundriss_A.pdf', createdAt: '2026-07-02T09:00:00.000Z', changeSummary: null },
      ])
    })

    it('stops at a loop instead of walking it forever', async () => {
      vi.mocked(readRevisionLinkNames).mockImplementation(async (ref) =>
        ref.filename === 'Grundriss_C.pdf'
          ? names({ supersedes: ['Grundriss_B.pdf'] })
          : names({ supersedes: ['Grundriss_C.pdf'] }),
      )
      vi.mocked(findRevisionCounterparts).mockResolvedValue([B, C])

      const facts = await loadRevisionLinks(session, [subject({ id: 'doc-c', filename: 'Grundriss_C.pdf' })], reader)

      expect(facts.get('doc-c')?.history?.map((entry) => entry.filename)).toEqual(['Grundriss_B.pdf'])
    })

    it('leaves out an older Fassung the reader may not open, and keeps the ones behind it they may', async () => {
      vi.mocked(readRevisionLinkNames).mockImplementation(async (ref) => byName[ref.filename] ?? null)
      vi.mocked(findRevisionCounterparts).mockResolvedValue([A, C])

      const facts = await loadRevisionLinks(session, [subject({ id: 'doc-c', filename: 'Grundriss_C.pdf' })], reader)

      expect(JSON.stringify([...facts.values()])).not.toContain('Grundriss_B')
      expect(facts.get('doc-c')?.history?.map((entry) => entry.filename)).toEqual(['Grundriss_A.pdf'])
    })
  })
})
