/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { recordAuditEvent, type AuditEventInput } from '@/lib/audit/service'
import { findConversationInOrg } from '@/lib/conversations/repository'
import type { Conversation } from '@/lib/db/schema/conversations'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { addProjectMemoryItem, createOrganizationMemoryItem } from '@/lib/projects/service'
import { applyProposal, dismissProposal } from '@/lib/proposals/client'
import { claimProposedChange, dismissProposedChange, findProposedChange, insertProposedChange, releaseProposedChange, settleProposedChange } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/db/schema/proposed-changes'
import { createProposal } from '@/lib/proposals/service'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { expectRegistered } from '@/test-utils/audit'
import { ID, CONVERSATION, MOVE, NOTE, PROJECT, assertChecks, folder, listed, memoryRow, person, profileRow, row, undecided } from '@/lib/proposals/proposal.fixtures'
import { memoryItem, readOnly, run } from './route.fixtures'

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

describe('the audit trail of a proposal', () => {
  const MESSAGE = '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d'
  const audited = (): AuditEventInput[] => vi.mocked(recordAuditEvent).mock.calls.map(([input]) => input)
  afterEach(() => {
    for (const [input] of vi.mocked(recordAuditEvent).mock.calls) expectRegistered(input)
  })
  const TARGETS = [
    { type: 'project', id: PROJECT },
    { type: 'conversation', id: CONVERSATION },
  ]

  beforeEach(() => {
    vi.mocked(addProjectMemoryItem).mockResolvedValue(memoryItem('mem_project'))
    vi.mocked(createOrganizationMemoryItem).mockResolvedValue(memoryItem('mem_org'))
    vi.mocked(findConversationInOrg).mockResolvedValue({ id: CONVERSATION } as Partial<Conversation> as Conversation)
  })

  it('records an apply once, as the decider, with how it went and for whom the agent proposed it', async () => {
    vi.mocked(resolveProjectDocumentsByName).mockImplementation(async (_s, _p, names) =>
      names.includes('Schnitt A-A.pdf') ? [listed('doc_aa', 'Schnitt A-A.pdf')] : []
    )

    await applyProposal(ID, run)

    expect(audited()).toEqual([
      {
        action: 'agent.proposal.decided',
        organizationId: 'org_1',
        actor: { userId: 'user_1', email: 'anna@example.test' },
        targetType: 'proposed_change',
        targetId: ID,
        alsoTargets: TARGETS,
        metadata: {
          kind: 'file_operation',
          decision: 'partially_applied',
          operation: 'move',
          items: 2,
          appliedItems: 1,
          memoryScope: null,
          onBehalfOf: 'user_2',
          messageId: MESSAGE,
        },
      },
    ])
    expect(JSON.stringify(audited())).not.toMatch(/Grundriss|Schnitt|Einreichung/)
  })

  it('records a dismissal, and the memory scope a note went into rather than the one proposed', async () => {
    await dismissProposal(ID, run)
    store.set(ID, memoryRow({ scope: 'organization' }))
    await applyProposal(ID, { memoryScope: 'project' }, run)
    store.set(ID, profileRow())
    await dismissProposal(ID, run)

    expect(audited().map((input) => input.metadata)).toEqual([
      expect.objectContaining({ kind: 'file_operation', decision: 'dismissed', appliedItems: 0 }),
      expect.objectContaining({ kind: 'memory', decision: 'applied', items: 1, appliedItems: 1, memoryScope: 'project' }),
      expect.objectContaining({ kind: 'project_profile', decision: 'dismissed', items: 1, memoryScope: null }),
    ])
    expect(JSON.stringify(audited())).not.toMatch(/Flachdach|Tirol/)
  })

  it('records nothing for a decision that did not happen', async () => {
    readOnly()
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor', closed: false, readsBecauseClosed: false })
    store.set(ID, row({ applyingBy: 'user_2', applyingSince: new Date() }))
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 409 })
    store.set(ID, row({ status: 'dismissed', decidedBy: 'user_2', decidedAt: new Date() }))
    await expect(dismissProposal(ID, run)).rejects.toMatchObject({ status: 409 })

    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('records a filed proposal once, as the person the agent acted for, and a repeated card not again', async () => {
    vi.mocked(insertProposedChange).mockResolvedValueOnce({ row: row({ onBehalfOf: 'user_1' }), created: true })
    await createProposal(SESSION as never, {
      projectId: PROJECT,
      kind: 'file_operation',
      payload: MOVE,
      conversationId: CONVERSATION,
      answerMessageId: MESSAGE,
      originCardIndex: 0,
    })
    vi.mocked(insertProposedChange).mockResolvedValueOnce({ row: row({ onBehalfOf: 'user_1' }), created: false })
    await createProposal(SESSION as never, {
      projectId: PROJECT,
      kind: 'file_operation',
      payload: MOVE,
      conversationId: CONVERSATION,
      answerMessageId: MESSAGE,
      originCardIndex: 0,
    })

    expect(audited()).toEqual([
      {
        action: 'agent.proposal.created',
        organizationId: 'org_1',
        actor: { userId: 'user_1', email: 'anna@example.test' },
        targetType: 'proposed_change',
        targetId: ID,
        alsoTargets: TARGETS,
        metadata: { kind: 'file_operation', operation: 'move', items: 2, memoryScope: null, messageId: MESSAGE },
      },
    ])
  })

  it('records where a proposed note would go', async () => {
    vi.mocked(insertProposedChange).mockResolvedValueOnce({ row: memoryRow({ scope: 'organization' }), created: true })
    await createProposal(SESSION as never, {
      projectId: PROJECT,
      kind: 'memory',
      payload: { ...NOTE, scope: 'organization' },
      conversationId: null,
      answerMessageId: null,
    })

    expect(audited()[0].metadata).toMatchObject({ kind: 'memory', items: 1, memoryScope: 'organization' })
    expect(JSON.stringify(audited())).not.toContain('Flachdach')
  })

  it('does not let a failing trail fail the decision or the filing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(recordAuditEvent).mockRejectedValueOnce(new Error('WorkOS down'))
    vi.mocked(recordAuditEvent).mockImplementationOnce(() => {
      throw new Error('WorkOS down')
    })

    const { proposal } = await applyProposal(ID, run)
    vi.mocked(insertProposedChange).mockResolvedValueOnce({ row: row({ id: '1b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c' }), created: true })
    await expect(
      createProposal(SESSION as never, { projectId: PROJECT, kind: 'file_operation', payload: MOVE, conversationId: null, answerMessageId: null })
    ).resolves.toMatchObject({ id: '1b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c' })

    expect(proposal.status).toBe('applied')
    await vi.waitFor(() =>
      expect(warn.mock.calls.filter(([message]) => String(message).startsWith('[Audit]'))).toHaveLength(2)
    )
    warn.mockRestore()
  })
})
