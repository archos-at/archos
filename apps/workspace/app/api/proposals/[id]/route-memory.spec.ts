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

import { ConversationConfinedError, CrossProjectMemoryError, ForbiddenError } from '@/lib/api/errors'
import { requireProjectAccess } from '@/lib/authz/projects'
import { requireMayRememberFrom } from '@/lib/conversations/cross-project-use'
import { requireMayLeaveConversation } from '@/lib/conversations/restricted-egress'
import { readConversationTemporary } from '@/lib/conversations/temporary-repository'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { addProjectMemoryItem, createOrganizationMemoryItem } from '@/lib/projects/service'
import { applyProposal, getProposal } from '@/lib/proposals/client'
import { claimProposedChange, dismissProposedChange, findProposedChange, releaseProposedChange, settleProposedChange } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/db/schema/proposed-changes'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { ID, CONVERSATION, NOTE, PROJECT, assertChecks, folder, listed, memoryRow, person, row, undecided } from '@/lib/proposals/proposal.fixtures'
import { memoryItem, run } from './route.fixtures'

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

describe('applying a memory note', () => {
  beforeEach(() => {
    vi.mocked(addProjectMemoryItem).mockResolvedValue(memoryItem('mem_project'))
    vi.mocked(createOrganizationMemoryItem).mockResolvedValue(memoryItem('mem_org'))
  })

  it('reads as a typed note', async () => {
    store.set(ID, memoryRow())
    const { proposal } = await getProposal(ID, run)
    expect(proposal).toMatchObject({ kind: 'memory', payload: NOTE, canDecide: true })
  })

  it('files a project note through the panel’s service, linked to its conversation, retiring the note it corrects', async () => {
    store.set(ID, memoryRow())
    const { proposal } = await applyProposal(ID, run)

    expect(requireMayRememberFrom).toHaveBeenCalledWith(CONVERSATION, 'org_1')
    expect(addProjectMemoryItem).toHaveBeenCalledWith(
      SESSION,
      PROJECT,
      { kind: 'decision', content: NOTE.content, confidence: 'high', sourceConversationId: CONVERSATION },
      { supersedesContent: 'Das Dach wird als Satteldach ausgeführt' }
    )
    expect(createOrganizationMemoryItem).not.toHaveBeenCalled()
    expect(proposal).toMatchObject({
      status: 'applied',
      decidedBy: 'user_1',
      results: [
        {
          label: 'Das Dach wird als extensiv begrüntes Flachdach ausgeführt, mit Attika und innenliegender …',
          ok: true,
          itemId: 'mem_project',
          scope: 'project',
        },
      ],
    })
  })

  it('files an organization note in the office’s memory', async () => {
    store.set(ID, memoryRow({ scope: 'organization', supersedes: null, content: 'Wir runden Flächen auf zwei Stellen' }))
    const { proposal } = await applyProposal(ID, run)

    expect(createOrganizationMemoryItem).toHaveBeenCalledWith(
      SESSION,
      { kind: 'decision', content: 'Wir runden Flächen auf zwei Stellen', confidence: 'high', sourceConversationId: CONVERSATION },
      { supersedesContent: null }
    )
    expect(addProjectMemoryItem).not.toHaveBeenCalled()
    expect(proposal.results).toEqual([{ label: 'Wir runden Flächen auf zwei Stellen', ok: true, itemId: 'mem_org', scope: 'organization' }])
  })

  it('files an organization note in the project when the decider says so', async () => {
    store.set(ID, memoryRow({ scope: 'organization' }))
    const { proposal } = await applyProposal(ID, { memoryScope: 'project' }, run)

    expect(addProjectMemoryItem).toHaveBeenCalledWith(SESSION, PROJECT, expect.objectContaining({ kind: 'decision' }), {
      supersedesContent: NOTE.supersedes,
    })
    expect(createOrganizationMemoryItem).not.toHaveBeenCalled()
    expect(proposal.results).toEqual([expect.objectContaining({ ok: true, itemId: 'mem_project', scope: 'project' })])
  })

  it('never widens a project note to the office, and refuses a body it does not know', async () => {
    store.set(ID, memoryRow())
    const widen = (body: string) => run(`/api/proposals/${ID}/apply`, { method: 'POST', body })
    expect((await widen(JSON.stringify({ memoryScope: 'organization' }))).status).toBe(400)
    expect((await widen(JSON.stringify({ memoryScope: 'project', extra: 1 }))).status).toBe(400)
    expect((await widen('{not json')).status).toBe(400)
    expect(claimProposedChange).not.toHaveBeenCalled()
    expect((await widen('')).status).toBe(200)
    expect(addProjectMemoryItem).toHaveBeenCalledTimes(1)
  })

  it('refuses a note from a conversation that drew on another project’s restricted content, and gives the claim back', async () => {
    store.set(ID, memoryRow({ scope: 'organization' }))
    vi.mocked(requireMayRememberFrom).mockRejectedValueOnce(new CrossProjectMemoryError('Nicht aus diesem Gespräch'))

    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 409, code: 'CROSS_PROJECT_MEMORY' })
    expect(addProjectMemoryItem).not.toHaveBeenCalled()
    expect(createOrganizationMemoryItem).not.toHaveBeenCalled()
    expect(store.get(ID)).toMatchObject({ status: 'proposed', applyingBy: null, applyingSince: null })
  })

  it('refuses a note from a conversation that drew on a restricted folder of this project: memory is read by everyone in it', async () => {
    store.set(ID, memoryRow({ scope: 'project' }))
    vi.mocked(requireMayLeaveConversation).mockRejectedValueOnce(
      new ConversationConfinedError('memory', 'Nicht aus diesem Gespräch')
    )

    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    expect(requireMayLeaveConversation).toHaveBeenCalledWith(
      { conversationId: CONVERSATION, locale: 'de' },
      'org_1',
      'memory'
    )
    expect(addProjectMemoryItem).not.toHaveBeenCalled()
    expect(store.get(ID)).toMatchObject({ status: 'proposed', applyingBy: null, applyingSince: null })
  })

  it('refuses a note from a temporary conversation with the named 403, writes nothing, and leaves the proposal open', async () => {
    store.set(ID, memoryRow({ scope: 'organization' }))
    vi.mocked(readConversationTemporary).mockResolvedValueOnce(true)

    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403, code: 'TEMPORARY_CONVERSATION' })
    expect(readConversationTemporary).toHaveBeenCalledWith(CONVERSATION, 'org_1')
    expect(addProjectMemoryItem).not.toHaveBeenCalled()
    expect(createOrganizationMemoryItem).not.toHaveBeenCalled()
    expect(store.get(ID)).toMatchObject({ status: 'proposed', applyingBy: null, applyingSince: null })

    const { proposal } = await applyProposal(ID, run)
    expect(proposal.status).toBe('applied')
  })

  it('gives the claim back when the memory service refuses the decider', async () => {
    store.set(ID, memoryRow())
    vi.mocked(addProjectMemoryItem).mockRejectedValueOnce(new ForbiddenError('closed'))
    await expect(applyProposal(ID, run)).rejects.toMatchObject({ status: 403 })
    expect(store.get(ID)).toMatchObject({ status: 'proposed', applyingBy: null })
  })
})
