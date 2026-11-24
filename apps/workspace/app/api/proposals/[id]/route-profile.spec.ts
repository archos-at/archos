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
vi.mock('@/lib/office-shelf/service', () => ({ resolveOfficeShelfDocumentsByName: vi.fn() }))
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

import { BadRequestError, ConflictError, ConversationConfinedError, ForbiddenError } from '@/lib/api/errors'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { patchProjectProfile, type PatchedProjectProfile } from '@/lib/project-profile/profile-service'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { addProjectMemoryItem } from '@/lib/projects/service'
import { applyProposal } from '@/lib/proposals/client'
import { claimProposedChange, dismissProposedChange, findProposedChange, releaseProposedChange, settleProposedChange } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/db/schema/proposed-changes'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { ID, CONVERSATION, PROFILE, PROJECT, assertChecks, folder, listed, person, profileRow, row, undecided } from '@/lib/proposals/proposal.fixtures'
import { run } from './route.fixtures'

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

const patched = (extra: Partial<PatchedProjectProfile> = {}) => ({ ...extra }) as PatchedProjectProfile

describe('applying a profile change', () => {
  it('patches the profile with its conversation and the decider’s language as the origin', async () => {
    store.set(ID, profileRow())
    vi.mocked(patchProjectProfile).mockResolvedValue(patched())

    const { proposal } = await applyProposal(ID, run)

    expect(patchProjectProfile).toHaveBeenCalledWith(SESSION, PROJECT, PROFILE.patch, {
      conversationId: CONVERSATION,
      locale: 'de',
    })
    expect(proposal).toMatchObject({
      kind: 'project_profile',
      status: 'applied',
      results: [{ label: 'Bundesland: Tirol', ok: true }],
    })
  })

  it('patches without an origin when the proposal has no conversation', async () => {
    store.set(ID, profileRow({ originConversationId: null, originMessageId: null }))
    vi.mocked(patchProjectProfile).mockResolvedValue(patched())
    await applyProposal(ID, run)
    expect(patchProjectProfile).toHaveBeenCalledWith(SESSION, PROJECT, PROFILE.patch, undefined)
  })

  it('counts a colleague’s concurrent accept of the same change as applied', async () => {
    store.set(ID, profileRow())
    vi.mocked(patchProjectProfile).mockResolvedValue(patched({ alreadyApplied: true }))
    const { proposal } = await applyProposal(ID, run)
    expect(proposal).toMatchObject({ status: 'applied', results: [{ label: 'Bundesland: Tirol', ok: true }] })
  })

  it('fails on a version conflict and on a value outside the vocabulary, with the service’s reason', async () => {
    store.set(ID, profileRow())
    vi.mocked(patchProjectProfile).mockRejectedValueOnce(new ConflictError('Conflict: profile was modified by another request'))
    expect((await applyProposal(ID, run)).proposal).toMatchObject({
      status: 'failed',
      results: [{ label: 'Bundesland: Tirol', ok: false, reason: 'Conflict: profile was modified by another request' }],
    })

    store.set(ID, profileRow())
    vi.mocked(patchProjectProfile).mockRejectedValueOnce(new BadRequestError('Invalid value for "Bundesland"'))
    expect((await applyProposal(ID, run)).proposal).toMatchObject({
      status: 'failed',
      results: [{ ok: false, reason: 'Invalid value for "Bundesland"' }],
    })
  })

  it('gives the claim back on a 403, the decider’s or the confined conversation’s, and writes no result', async () => {
    for (const refusal of [
      new ForbiddenError('This project is closed and can only be read. Reopen it to change it.'),
      new ConversationConfinedError('profilePatch', 'Dieses Gespräch bleibt bei seinen Ordnern'),
    ]) {
      store.set(ID, profileRow())
      vi.mocked(patchProjectProfile).mockRejectedValueOnce(refusal)
      await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
      expect(store.get(ID)).toMatchObject({ status: 'proposed', applyingBy: null, results: null })
    }
    expect(releaseProposedChange).toHaveBeenCalledTimes(2)
  })

  it('ignores a memory scope in the body', async () => {
    store.set(ID, profileRow())
    vi.mocked(patchProjectProfile).mockResolvedValue(patched())
    await expect(applyProposal(ID, { memoryScope: 'project' }, run)).resolves.toMatchObject({
      proposal: { status: 'applied' },
    })
    expect(addProjectMemoryItem).not.toHaveBeenCalled()
  })
})
