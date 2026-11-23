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

import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { recordDecisionScore } from '@/lib/langfuse/decision-score'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { onProposalDecided } from '@/lib/proposals/attention'
import { applyProposal, dismissProposal } from '@/lib/proposals/client'
import { publishProposalDecided } from '@/lib/proposals/live'
import { claimProposedChange, dismissProposedChange, findProposedChange, releaseProposedChange, settleProposedChange } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/db/schema/proposed-changes'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { ID, CONVERSATION, assertChecks, folder, listed, person, row, undecided } from '@/lib/proposals/proposal.fixtures'
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

const afterCommit = () => vi.waitFor(() => expect(publishProposalDecided).toHaveBeenCalled())

describe('what follows a decision (live card, inbox, Langfuse)', () => {
  const ORIGIN = { conversationId: CONVERSATION, messageId: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d' }

  it('tells the live channel, the inbox and Langfuse when it is applied', async () => {
    await applyProposal(ID, run)
    await afterCommit()

    expect(publishProposalDecided).toHaveBeenCalledWith(ID, 'applied')
    expect(onProposalDecided).toHaveBeenCalledWith({ organizationId: 'org_1', proposalId: ID })
    expect(recordDecisionScore).toHaveBeenCalledWith({
      organizationId: 'org_1',
      subject: 'proposal',
      subjectId: ID,
      decision: 'accepted',
      decidedBy: 'user_1',
      origin: ORIGIN,
      traceId: null,
    })
  })

  it('counts a partly applied proposal as accepted', async () => {
    vi.mocked(resolveProjectDocumentsByName).mockImplementation(async (_s, _p, names) =>
      names.includes('Schnitt A-A.pdf') ? [listed('doc_aa', 'Schnitt A-A.pdf')] : []
    )
    await applyProposal(ID, run)
    await afterCommit()

    expect(publishProposalDecided).toHaveBeenCalledWith(ID, 'partially_applied')
    expect(recordDecisionScore).toHaveBeenCalledWith(expect.objectContaining({ decision: 'accepted' }))
  })

  it('announces a failed apply, but scores nothing: nothing was taken', async () => {
    vi.mocked(resolveProjectDocumentsByName).mockResolvedValue([])
    await applyProposal(ID, run)
    await afterCommit()

    expect(publishProposalDecided).toHaveBeenCalledWith(ID, 'failed')
    expect(onProposalDecided).toHaveBeenCalledTimes(1)
    expect(recordDecisionScore).not.toHaveBeenCalled()
  })

  it('scores a dismissal as dismissed', async () => {
    await dismissProposal(ID, run)
    await afterCommit()

    expect(publishProposalDecided).toHaveBeenCalledWith(ID, 'dismissed')
    expect(onProposalDecided).toHaveBeenCalledTimes(1)
    expect(recordDecisionScore).toHaveBeenCalledWith(expect.objectContaining({ decision: 'dismissed', origin: ORIGIN }))
  })

  it('leaves the turn to be looked up when the proposal names none', async () => {
    store.set(ID, row({ originConversationId: null, originMessageId: null }))
    await dismissProposal(ID, run)
    await afterCommit()

    expect(recordDecisionScore).toHaveBeenCalledWith(expect.objectContaining({ origin: null }))
  })

  it('says nothing for a decision that did not happen', async () => {
    readOnly()
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    store.set(ID, row({ applyingBy: 'user_2', applyingSince: new Date() }))
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor', closed: false, readsBecauseClosed: false })
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 409 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(publishProposalDecided).not.toHaveBeenCalled()
    expect(onProposalDecided).not.toHaveBeenCalled()
    expect(recordDecisionScore).not.toHaveBeenCalled()
  })

  it('does not let a failing side effect fail the decision', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(publishProposalDecided).mockRejectedValueOnce(new Error('hub down'))
    vi.mocked(onProposalDecided).mockRejectedValueOnce(new Error('inbox down'))
    vi.mocked(recordDecisionScore).mockRejectedValueOnce(new Error('langfuse down'))

    const { proposal } = await applyProposal(ID, run)
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(3))

    expect(proposal.status).toBe('applied')
    warn.mockRestore()
  })
})
