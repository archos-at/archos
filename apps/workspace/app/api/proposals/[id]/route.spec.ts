/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSION = vi.hoisted(() => ({
  userId: 'user_1',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  email: 'anna@example.test',
  name: 'Anna Berger',
  role: 'member',
  permissions: [] as string[],
}))

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => SESSION) }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn() }))
vi.mock('@/lib/sharing/directory', () => ({ loadOrganizationDirectory: vi.fn() }))
vi.mock('@/lib/conversations/repository', () => ({ findConversationInOrg: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/documents/document-edits', () => ({
  renameDocument: vi.fn(),
}))
vi.mock('@/lib/documents/document-listing', () => ({
  resolveProjectDocumentsByName: vi.fn(),
}))
vi.mock('@/lib/office-shelf/service', () => ({ resolveOfficeShelfDocumentsByName: vi.fn(), assertMoveKeepsOutOfStandards: vi.fn(async () => undefined) }))
vi.mock('@/lib/office-shelf/folder-service', () => ({ listOfficeShelfFolders: vi.fn() }))
vi.mock('@/lib/projects/folder-service', () => ({ listProjectFolders: vi.fn(), createProjectFolder: vi.fn() }))
vi.mock('@/lib/documents/move-to-folder', () => ({ moveDocumentToFolder: vi.fn() }))
vi.mock('@/lib/assignments/service', () => ({
  listAssignmentCandidates: vi.fn(),
  addResourceAssignment: vi.fn(),
}))
vi.mock('@/lib/proposals/live', () => ({ publishProposalDecided: vi.fn(async () => undefined) }))
vi.mock('@/lib/proposals/attention', () => ({
  onProposalCreated: vi.fn(async () => undefined),
  onProposalDecided: vi.fn(async () => undefined),
}))
vi.mock('@/lib/langfuse/decision-score', () => ({ recordDecisionScore: vi.fn(async () => undefined) }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/projects/service', () => ({
  MEMORY_WRITE_PERMISSIONS: ['project:memory:write', 'project:edit'],
  addProjectMemoryItem: vi.fn(),
  createOrganizationMemoryItem: vi.fn(),
}))
vi.mock('@/lib/project-profile/profile-service', () => ({ patchProjectProfile: vi.fn() }))
vi.mock('@/lib/conversations/cross-project-use', () => ({ requireMayRememberFrom: vi.fn(async () => undefined) }))
vi.mock('@/lib/conversations/restricted-egress', () => ({ requireMayLeaveConversation: vi.fn(async () => undefined) }))
vi.mock('@/lib/conversations/temporary-repository', () => ({
  readConversationTemporary: vi.fn(async () => false),
  updateConversationTemporaryInOrg: vi.fn(),
}))
vi.mock('@/i18n/server', () => ({ getLocale: vi.fn(async () => 'de') }))
vi.mock('@/lib/limits/enforce', async (original) => ({
  ...(await original<typeof import('@/lib/limits/enforce')>()),
  enforceLimit: vi.fn(async () => undefined),
}))
vi.mock('@/lib/proposals/repository', () => ({
  insertProposedChange: vi.fn(),
  findProposedChange: vi.fn(),
  claimProposedChange: vi.fn(),
  settleProposedChange: vi.fn(),
  releaseProposedChange: vi.fn(),
  dismissProposedChange: vi.fn(),
}))

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { addResourceAssignment, listAssignmentCandidates } from '@/lib/assignments/service'
import { requireProjectAccess } from '@/lib/authz/projects'
import { renameDocument } from '@/lib/documents/document-edits'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { createProjectFolder, listProjectFolders } from '@/lib/projects/folder-service'
import { listOfficeShelfFolders } from '@/lib/office-shelf/folder-service'
import { resolveOfficeShelfDocumentsByName } from '@/lib/office-shelf/service'
import { patchProjectProfile } from '@/lib/project-profile/profile-service'
import { addProjectMemoryItem } from '@/lib/projects/service'
import { applyProposal, dismissProposal, getProposal, ProposalRequestError } from '@/lib/proposals/client'
import { claimProposedChange, dismissProposedChange, findProposedChange, releaseProposedChange, settleProposedChange } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/db/schema/proposed-changes'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { ID, CONVERSATION, MOVE, PROJECT, assertChecks, folder, listed, memoryRow, person, profileRow, row, undecided } from '@/lib/proposals/proposal.fixtures'
import { readOnly, run } from './route.fixtures'

let store: Map<string, ProposedChangeRow>
const put = (next: ProposedChangeRow) => {
  assertChecks(next)
  store.set(next.id, next)
  return next
}

beforeEach(() => {
  vi.clearAllMocks()
  store = new Map([[ID, row()]])
  vi.mocked(findProposedChange).mockImplementation(async (_org, id) => store.get(id) ?? null)
  vi.mocked(claimProposedChange).mockImplementation(async (_org, id, userId, staleBefore) => {
    const current = store.get(id)
    if (!undecided(current, staleBefore) || !current) return null
    return put({ ...current, applyingBy: userId, applyingSince: new Date() })
  })
  vi.mocked(settleProposedChange).mockImplementation(async (_org, claim, outcome) => {
    const current = store.get(claim.id)
    if (!current || current.status !== 'proposed' || current.applyingBy !== claim.applyingBy) return null
    return put({
      ...current,
      ...outcome,
      decidedBy: claim.applyingBy,
      decidedAt: new Date(),
      applyingBy: null,
      applyingSince: null,
    })
  })
  vi.mocked(releaseProposedChange).mockImplementation(async (_org, claim) => {
    const current = store.get(claim.id)
    if (current?.applyingBy === claim.applyingBy) put({ ...current, applyingBy: null, applyingSince: null })
  })
  vi.mocked(dismissProposedChange).mockImplementation(async (_org, id, userId, staleBefore) => {
    const current = store.get(id)
    if (!undecided(current, staleBefore) || !current) return null
    return put({ ...current, status: 'dismissed', decidedBy: userId, decidedAt: new Date() })
  })

  vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor', closed: false, readsBecauseClosed: false })
  vi.mocked(requireResourceAccess).mockResolvedValue({} as never)
  vi.mocked(loadOrganizationDirectory).mockResolvedValue(
    new Map([
      ['user_1', person('user_1', 'Anna Berger', 'anna@example.test')],
      ['user_2', person('user_2', 'Bernd Huber', 'bernd@example.test')],
    ])
  )
  vi.mocked(resolveProjectDocumentsByName).mockImplementation(async (_session, _project, names) =>
    names.flatMap((name) => {
      if (name.toLowerCase() === 'grundriss eg.pdf') {
        return [listed('doc_old', 'Grundriss EG.pdf', '2026-01-01T08:00:00Z'), listed('doc_eg', 'grundriss eg.PDF')]
      }
      if (name === 'Schnitt A-A.pdf') return [listed('doc_aa', 'Schnitt A-A.pdf')]
      return []
    })
  )
  vi.mocked(listProjectFolders).mockResolvedValue([folder('f_ein', 'Einreichung'), folder('f_plaene', 'Einreichung/Pläne')])
  vi.mocked(moveDocumentToFolder).mockImplementation(async ({ documentId, folderId }) => ({
    ok: true,
    document: { id: documentId, folderId },
  }))
})

describe('GET /api/proposals/[id]', () => {
  it('reads the proposal with the names of who it was made for, and says the reader may decide', async () => {
    const { proposal } = await getProposal(ID, run)

    expect(proposal).toMatchObject({
      id: ID,
      projectId: PROJECT,
      kind: 'file_operation',
      status: 'proposed',
      proposedByKind: 'piloti',
      onBehalfOf: 'user_2',
      onBehalfOfName: 'Bernd Huber',
      originConversationId: CONVERSATION,
      decidedBy: null,
      results: null,
      canDecide: true,
      payload: MOVE,
    })
    expect(requireProjectAccess).toHaveBeenCalledWith(SESSION, PROJECT, 'project:view')
    expect(requireResourceAccess).toHaveBeenCalledWith(SESSION, 'conversation', CONVERSATION, 'viewer')
  })

  it('shows a read-only reader the proposal without the controls', async () => {
    readOnly()
    const { proposal } = await getProposal(ID, run)
    expect(proposal.canDecide).toBe(false)
  })

  it('is a 404 to a reader without the project, and to one without the conversation it was made in', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new NotFoundError())
    await expect(getProposal(ID, run)).rejects.toMatchObject({ status: 404 })

    vi.mocked(requireResourceAccess).mockRejectedValueOnce(new NotFoundError())
    await expect(getProposal(ID, run)).rejects.toMatchObject({ status: 404 })
  })

  it('is a 404 for an id that is not there', async () => {
    store.clear()
    await expect(getProposal(ID, run)).rejects.toBeInstanceOf(ProposalRequestError)
    await expect(getProposal(ID, run)).rejects.toMatchObject({ status: 404 })
  })

  it('does not offer a decision while somebody is applying it', async () => {
    store.set(ID, row({ applyingBy: 'user_2', applyingSince: new Date() }))
    const { proposal } = await getProposal(ID, run)
    expect(proposal).toMatchObject({ status: 'proposed', canDecide: false })
  })
})

describe('POST /api/proposals/[id]/apply', () => {
  it('moves each document through the move service, as the decider, resolving names and paths', async () => {
    const { proposal } = await applyProposal(ID, run)

    expect(moveDocumentToFolder).toHaveBeenNthCalledWith(1, { documentId: 'doc_eg', folderId: 'f_plaene' }, SESSION)
    expect(moveDocumentToFolder).toHaveBeenNthCalledWith(2, { documentId: 'doc_aa', folderId: 'f_plaene' }, SESSION)
    expect(resolveProjectDocumentsByName).toHaveBeenCalledWith(SESSION, PROJECT, ['Grundriss EG.pdf'])
    expect(listProjectFolders).toHaveBeenCalledTimes(1)
    expect(proposal).toMatchObject({
      status: 'applied',
      decidedBy: 'user_1',
      decidedByName: 'Anna Berger',
      canDecide: false,
      results: [
        { label: 'Grundriss EG.pdf', ok: true },
        { label: 'Schnitt A-A.pdf', ok: true },
      ],
    })
    expect(proposal.decidedAt).not.toBeNull()
  })

  it('is a 409 the second time: a double click applies once', async () => {
    await applyProposal(ID, run)
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' })
    expect(moveDocumentToFolder).toHaveBeenCalledTimes(2)
  })

  it('lets one of two clicks at the same moment apply, and refuses the other', async () => {
    const outcomes = await Promise.allSettled([applyProposal(ID, run), applyProposal(ID, run)])
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
    expect(moveDocumentToFolder).toHaveBeenCalledTimes(2)
  })

  it('records a partial apply item by item, and does not stop at the first failure', async () => {
    store.set(
      ID,
      row({
        payload: {
          operation: 'move',
          operations: [
            { document: 'Fehlt.pdf', target_folder: 'Einreichung' },
            { document: 'Schnitt A-A.pdf', target_folder: 'Einreichung' },
          ],
        },
      })
    )

    const { proposal } = await applyProposal(ID, run)

    expect(proposal.status).toBe('partially_applied')
    expect(proposal.results).toEqual([
      { label: 'Fehlt.pdf', ok: false, reason: '„Fehlt.pdf“ wurde nicht gefunden' },
      { label: 'Schnitt A-A.pdf', ok: true },
    ])
  })

  it('is `failed` when no item went through, with the service’s own refusal as the reason', async () => {
    vi.mocked(moveDocumentToFolder).mockResolvedValue({ ok: false, error: 'Folder not found in this project.' })

    const { proposal } = await applyProposal(ID, run)

    expect(proposal.status).toBe('failed')
    expect(proposal.results?.every((result) => !result.ok && result.reason === 'Folder not found in this project.')).toBe(
      true
    )
  })

  it('fails a move into a folder that is gone, by its path', async () => {
    store.set(
      ID,
      row({ payload: { operation: 'move', operations: [{ document: 'Schnitt A-A.pdf', target_folder: 'Archiv/Alt' }] } })
    )
    const { proposal } = await applyProposal(ID, run)
    expect(proposal.results).toEqual([
      { label: 'Schnitt A-A.pdf', ok: false, reason: 'Ordner „Archiv/Alt“ existiert nicht (mehr)' },
    ])
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('moves an Archiv document within the Archiv’s own folders, and to the root on an empty path', async () => {
    vi.mocked(resolveOfficeShelfDocumentsByName).mockResolvedValue([listed('doc_b', 'Vorlage.docx')])
    vi.mocked(listOfficeShelfFolders).mockResolvedValue([folder('a_vorlagen', 'Vorlagen')])
    store.set(
      ID,
      row({
        payload: {
          operation: 'move',
          operations: [
            { document: 'Vorlage.docx', source: 'office', target_folder: 'Vorlagen' },
            { document: 'Vorlage.docx', source: 'office', target_folder: '' },
          ],
        },
      })
    )

    const { proposal } = await applyProposal(ID, run)

    expect(proposal.status).toBe('applied')
    expect(moveDocumentToFolder).toHaveBeenNthCalledWith(1, { documentId: 'doc_b', folderId: 'a_vorlagen' }, SESSION)
    expect(moveDocumentToFolder).toHaveBeenNthCalledWith(2, { documentId: 'doc_b', folderId: null }, SESSION)
    expect(listProjectFolders).not.toHaveBeenCalled()
  })

  it('renames through the rename service, with the request for its audit trail', async () => {
    store.set(
      ID,
      row({
        payload: {
          operation: 'rename',
          operations: [{ document: 'Schnitt A-A.pdf', new_display_name: 'Schnitt A-A Einreichung' }],
        },
      })
    )
    vi.mocked(renameDocument).mockResolvedValue({ id: 'doc_aa', filename: 'Schnitt A-A.pdf', displayName: 'x' })

    const { proposal } = await applyProposal(ID, run)

    expect(renameDocument).toHaveBeenCalledWith(SESSION, 'doc_aa', 'Schnitt A-A Einreichung', expect.any(Request))
    expect(proposal.status).toBe('applied')
  })

  it('creates a folder under the parent its path names', async () => {
    store.set(
      ID,
      row({
        payload: { operation: 'create_folder', operations: [{ folder_name: 'Statik', parent_folder: 'Einreichung' }] },
      })
    )
    vi.mocked(createProjectFolder).mockResolvedValue({ ok: true, folder: folder('f_new', 'Einreichung/Statik') })

    const { proposal } = await applyProposal(ID, run)

    expect(createProjectFolder).toHaveBeenCalledWith({ projectId: PROJECT, parentId: 'f_ein', name: 'Statik' }, SESSION)
    expect(proposal.results).toEqual([{ label: 'Einreichung/Statik', ok: true }])
  })

  it('assigns the one member the name means, the decider included, and refuses an ambiguous name', async () => {
    vi.mocked(listAssignmentCandidates).mockResolvedValue([
      person('user_2', 'Bernd Huber', 'bernd@example.test'),
      person('user_3', 'Chris Maier', 'chris@example.test'),
      person('user_4', 'Chris Maier', 'chris.m@example.test'),
    ])
    vi.mocked(addResourceAssignment).mockResolvedValue([])
    store.set(
      ID,
      row({
        payload: {
          operation: 'assign',
          operations: [
            { document: 'Schnitt A-A.pdf', member: 'bernd@example.test' },
            { document: 'Schnitt A-A.pdf', member: 'Anna Berger' },
            { document: 'Schnitt A-A.pdf', member: 'Chris Maier' },
            { document: 'Schnitt A-A.pdf', member: 'Dora' },
          ],
        },
      })
    )

    const { proposal } = await applyProposal(ID, run)

    expect(addResourceAssignment).toHaveBeenNthCalledWith(1, SESSION, 'document', 'doc_aa', 'user_2', expect.any(Request))
    expect(addResourceAssignment).toHaveBeenNthCalledWith(2, SESSION, 'document', 'doc_aa', 'user_1', expect.any(Request))
    expect(proposal.status).toBe('partially_applied')
    expect(proposal.results?.map((result) => result.reason ?? 'ok')).toEqual([
      'ok',
      'ok',
      '„Chris Maier“ ist im Projekt mehrfach vergeben',
      '„Dora“ ist kein Mitglied dieses Projekts',
    ])
  })

  it('refuses a reader who may not write the project, before anything is claimed or run', async () => {
    readOnly()
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    expect(claimProposedChange).not.toHaveBeenCalled()
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('refuses a closed project with its own 403', async () => {
    vi.mocked(requireProjectAccess).mockImplementation(async (_session, _project, permission) => {
      if (permission === 'project:view') return { role: 'project-editor', closed: true, readsBecauseClosed: false }
      throw new ForbiddenError('This project is closed and can only be read. Reopen it to change it.')
    })
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    expect(claimProposedChange).not.toHaveBeenCalled()
  })

  it('is a 409 while a colleague is applying it, and gives a broken apply’s claim back', async () => {
    store.set(ID, row({ applyingBy: 'user_2', applyingSince: new Date() }))
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 409 })

    store.set(ID, row({ payload: { not: 'a payload' } }))
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 500 })
    expect(store.get(ID)).toMatchObject({ status: 'proposed', applyingBy: null, applyingSince: null })
  })

  it('takes over a claim that went stale', async () => {
    store.set(ID, row({ applyingBy: 'user_2', applyingSince: new Date(Date.now() - 6 * 60 * 1000) }))
    const { proposal } = await applyProposal(ID, run)
    expect(proposal).toMatchObject({ status: 'applied', decidedBy: 'user_1' })
  })
})

describe('POST /api/proposals/[id]/dismiss', () => {
  it('dismisses it in the reader’s name, and changes nothing in the workspace', async () => {
    const { proposal } = await dismissProposal(ID, run)

    expect(proposal).toMatchObject({ status: 'dismissed', decidedBy: 'user_1', results: null, canDecide: false })
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('is a 409 once it is decided, either way round', async () => {
    await dismissProposal(ID, run)
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 409 })
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 409 })

    store.set(ID, row())
    await applyProposal(ID, run)
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 409 })
  })

  it('is a 409 while somebody is applying it', async () => {
    store.set(ID, row({ applyingBy: 'user_2', applyingSince: new Date() }))
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 409 })
  })

  it('refuses a reader who may not write the project', async () => {
    readOnly()
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    expect(dismissProposedChange).not.toHaveBeenCalled()
  })
})

const holding = (...held: string[]) =>
  vi.mocked(requireProjectAccess).mockImplementation(async (_session, _project, permission) => {
    const wanted: readonly string[] = Array.isArray(permission) ? permission : [permission]
    if (wanted.includes('project:view') || wanted.some((slug) => held.includes(slug))) {
      return { role: 'project-editor', closed: false, readsBecauseClosed: false }
    }
    throw new NotFoundError()
  })

describe('one gate per kind', () => {
  it('lets a documents-only member decide a file operation, and neither a note nor a profile change', async () => {
    holding('project:documents:write')
    expect((await getProposal(ID, run)).proposal.canDecide).toBe(true)

    store.set(ID, memoryRow())
    expect((await getProposal(ID, run)).proposal.canDecide).toBe(false)
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 403 })

    store.set(ID, profileRow())
    expect((await getProposal(ID, run)).proposal.canDecide).toBe(false)
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    expect(claimProposedChange).not.toHaveBeenCalled()
    expect(addProjectMemoryItem).not.toHaveBeenCalled()
    expect(patchProjectProfile).not.toHaveBeenCalled()
  })

  it('lets a memory-only member decide a note and a profile change, and not a file operation', async () => {
    holding('project:memory:write')
    expect((await getProposal(ID, run)).proposal.canDecide).toBe(false)
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    expect(moveDocumentToFolder).not.toHaveBeenCalled()

    store.set(ID, memoryRow())
    expect((await getProposal(ID, run)).proposal.canDecide).toBe(true)
    store.set(ID, profileRow())
    expect((await getProposal(ID, run)).proposal.canDecide).toBe(true)
    await expect(dismissProposal(ID, run)).resolves.toMatchObject({ proposal: { status: 'dismissed' } })
  })

  it('asks for the right the memory and profile services write with', async () => {
    store.set(ID, memoryRow())
    await getProposal(ID, run)
    expect(requireProjectAccess).toHaveBeenCalledWith(SESSION, PROJECT, ['project:memory:write', 'project:edit'])
  })
})
