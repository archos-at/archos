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
import { findConversationInOrg } from '@/lib/conversations/repository'
import type { Conversation } from '@/lib/db/schema/conversations'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { onProposalCreated } from '@/lib/proposals/attention'
import { claimProposedChange, dismissProposedChange, findProposedChange, insertProposedChange, releaseProposedChange, settleProposedChange } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/db/schema/proposed-changes'
import { createProposal } from '@/lib/proposals/service'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { ID, CONVERSATION, MOVE, NOTE, PROFILE, PROJECT, assertChecks, folder, listed, memoryRow, person, profileRow, row, undecided } from '@/lib/proposals/proposal.fixtures'

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

describe('createProposal — the inbox is told', () => {
  it('tells the attention slice, with a line naming the files', async () => {
    vi.mocked(insertProposedChange).mockResolvedValue({ row: row(), created: true })

    await createProposal(SESSION as never, {
      projectId: PROJECT,
      kind: 'file_operation',
      payload: { operation: 'move', operations: [...MOVE.operations, { document: 'Lageplan.pdf', source: 'project', target_folder: 'Einreichung' }] },
      conversationId: null,
      answerMessageId: null,
    })
    await vi.waitFor(() => expect(onProposalCreated).toHaveBeenCalled())

    expect(onProposalCreated).toHaveBeenCalledWith({
      organizationId: 'org_1',
      projectId: PROJECT,
      proposalId: ID,
      originConversationId: CONVERSATION,
      onBehalfOf: 'user_2',
      summary: 'Grundriss EG.pdf, Schnitt A-A.pdf +1',
      variant: 'move',
    })
  })

  it('does not fail the proposal when the inbox write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(insertProposedChange).mockResolvedValue({ row: row(), created: true })
    vi.mocked(onProposalCreated).mockRejectedValueOnce(new Error('inbox down'))

    await expect(
      createProposal(SESSION as never, {
        projectId: PROJECT,
        kind: 'file_operation',
        payload: MOVE,
        conversationId: null,
        answerMessageId: null,
      })
    ).resolves.toMatchObject({ id: ID })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
  })
})

describe('createProposal — every kind, once per card', () => {
  const create = (input: Partial<Parameters<typeof createProposal>[1]>) =>
    createProposal(SESSION as never, {
      projectId: PROJECT,
      kind: 'file_operation',
      payload: MOVE,
      conversationId: null,
      answerMessageId: null,
      ...input,
    })

  it('files a note and a profile change, each with its own inbox line', async () => {
    vi.mocked(insertProposedChange).mockResolvedValue({ row: memoryRow(), created: true })
    await create({ kind: 'memory', payload: NOTE })
    expect(insertProposedChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'memory', payload: NOTE }))
    await vi.waitFor(() =>
      expect(onProposalCreated).toHaveBeenLastCalledWith(
        expect.objectContaining({
          summary: 'Das Dach wird als extensiv begrüntes Flachdach ausgeführt, mit Attika und innenliegender …',
        })
      )
    )

    vi.mocked(insertProposedChange).mockResolvedValue({ row: profileRow(), created: true })
    await create({ kind: 'project_profile', payload: PROFILE })
    expect(insertProposedChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'project_profile', payload: PROFILE })
    )
    await vi.waitFor(() =>
      expect(onProposalCreated).toHaveBeenLastCalledWith(expect.objectContaining({ summary: 'Bundesland: Tirol' }))
    )
  })

  it('refuses a profile value outside the intake vocabulary when it is proposed', async () => {
    await expect(
      create({
        kind: 'project_profile',
        payload: { ...PROFILE, patch: [{ op: 'replace', path: '/facts/federal_state/value', value: 'atlantis' }] },
      })
    ).rejects.toMatchObject({ status: 422, details: { reason: 'proposal-profile-vocabulary' } })
    expect(insertProposedChange).not.toHaveBeenCalled()
  })

  it('refuses a payload of another kind than it names', async () => {
    await expect(create({ kind: 'memory', payload: MOVE })).rejects.toThrow()
    expect(insertProposedChange).not.toHaveBeenCalled()
  })

  it('passes the card index with its answer, and drops one without an answer', async () => {
    vi.mocked(insertProposedChange).mockResolvedValue({ row: row(), created: true })
    await create({ answerMessageId: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', originCardIndex: 2 })
    expect(insertProposedChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ originMessageId: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', originCardIndex: 2 })
    )
    await create({ originCardIndex: 2 })
    expect(insertProposedChange).toHaveBeenLastCalledWith(expect.objectContaining({ originCardIndex: null }))
  })

  it('returns the first proposal for the same card, as it stands, and tells the inbox nothing again', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValue({ id: CONVERSATION } as Partial<Conversation> as Conversation)
    const first = row({ status: 'dismissed', decidedBy: 'user_2', decidedAt: new Date(), originCardIndex: 0 })
    vi.mocked(insertProposedChange).mockResolvedValue({ row: first, created: false })

    await expect(
      create({ conversationId: CONVERSATION, answerMessageId: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', originCardIndex: 0 })
    ).resolves.toMatchObject({ id: ID, status: 'dismissed' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onProposalCreated).not.toHaveBeenCalled()
  })

  it.each([
    ['another project', { projectId: 'project-other' }],
    ['another conversation', { originConversationId: 'conversation-other' }],
    ['another kind', { kind: 'memory' as const, payload: NOTE }],
  ])('never hands back a first proposal filed for %s under the same card', async (_, foreign) => {
    vi.mocked(findConversationInOrg).mockResolvedValue({ id: CONVERSATION } as Partial<Conversation> as Conversation)
    vi.mocked(insertProposedChange).mockResolvedValue({ row: row({ originCardIndex: 0, ...foreign }), created: false })

    await expect(
      create({ conversationId: CONVERSATION, answerMessageId: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', originCardIndex: 0 })
    ).rejects.toMatchObject({ details: { reason: 'proposal-card-taken' } })
  })
})
