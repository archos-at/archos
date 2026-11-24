/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  rows: [] as ConversationAudienceRow[],
  reads: 0,
  record: { folders: [] as string[], otherProjects: [] as string[] },
}))

vi.mock('./audience', async (original) => ({
  ...(await original<typeof import('./audience')>()),
  readConversationRow: vi.fn(async () => {
    state.reads += 1
    return state.rows.length > 1 ? state.rows.shift()! : state.rows[0]
  }),
}))
vi.mock('@/lib/conversations/restricted-use', () => ({
  conversationRecord: vi.fn(async () => state.record),
  sourceFoldersOf: vi.fn(async (_org: string, _project: unknown, collections: string[]) => collections.map((c) => `folder:${c}`)),
}))
vi.mock('@/lib/turns/feature-entitlement', () => ({
  featureEntitlement: vi.fn(async () => ({ deepResearch: true, tasks: true })),
}))
vi.mock('@/lib/retrieval-scope/collection-scope-request', () => ({
  buildCollectionScopeFromRequest: vi.fn(
    async (_session: unknown, request: { projectId?: string; conversationId?: string; audience?: ConversationAudienceRow; interactiveChat?: boolean }) => {
      const projectId = request.audience?.exists ? (request.audience.projectId ?? undefined) : request.projectId
      const restricted = request.interactiveChat && projectId ? [`proj_${projectId}_restricted`] : []
      const scopedCollections = [
        { collection: 'oib_knowledge', shelf: 'base' as const },
        { collection: 'office_org_1', shelf: 'office_shelf' as const },
        ...(projectId ? [{ collection: `proj_${projectId}`, shelf: 'project' as const }] : []),
        ...restricted.map((collection) => ({ collection, shelf: 'project' as const })),
        ...(request.conversationId ? [{ collection: `s_${request.conversationId}`, shelf: 'session' as const }] : []),
      ]
      return {
        scope: scopedCollections.map((entry) => entry.collection),
        scopedCollections,
        headerValue: '',
        projectId,
        projectCollectionName: projectId ? `proj_${projectId}` : undefined,
        conversationId: undefined,
        verifiedConversationId: undefined,
        restrictedCollections: restricted,
      }
    },
  ),
}))

import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import { resolveConversationContext, resolveConversationScope, resolveRunConversationContext } from './resolve'
import { conversationRecord, sourceFoldersOf } from '@/lib/conversations/restricted-use'
import { featureEntitlement } from '@/lib/turns/feature-entitlement'

const OWNER = 'user_owner'
const session = { userId: OWNER, organizationId: 'org_1' } as AuthorizedSession
const row = (extra: Partial<ConversationAudienceRow> = {}): ConversationAudienceRow => ({
  exists: true,
  projectId: null,
  createdBy: OWNER,
  visibility: 'private',
  grantees: [],
  version: 2,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.rows = [row()]
  state.reads = 0
  state.record = { folders: [], otherProjects: [] }
})

describe('resolveConversationContext', () => {
  it('reads the audience once per turn and hands the same row to the scope', async () => {
    const context = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' })

    expect(state.reads).toBe(1)
    expect(vi.mocked(buildCollectionScopeFromRequest).mock.calls[0]?.[1]).toMatchObject({ audience: state.rows[0] })
    expect(context.audience).toMatchObject({ solo: true, version: 2 })
  })

  it('takes the turn’s project from the conversation row, whatever the request names', async () => {
    state.rows = [row({ projectId: 'p_row' })]

    const context = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' })

    expect(context.projectId).toBe('p_row')
    expect(context.may.shelves.map((entry) => entry.collection)).toContain('proj_p_row')
  })

  it('takes a held audience instead of reading again', async () => {
    const held = row({ grantees: ['user_ina'], version: 5 })

    const context = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' }, { audience: { tx: {} as never, row: held } })

    expect(state.reads).toBe(0)
    expect(context.audience).toMatchObject({ solo: false, version: 5 })
  })

  it('draws on the personal shelf in a solo chat, and not in the next turn once the chat is shared', async () => {
    state.rows = [row(), row({ grantees: ['user_ina'], version: 3 })]

    const first = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' })
    const second = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' })

    expect(first.may).toMatchObject({ personalMemory: true, personalShelf: true, workspaceRead: 'all' })
    expect(second.may).toMatchObject({ personalMemory: false, personalShelf: false, workspaceRead: 'document+projectFacts' })
    expect(second.audience.version).toBe(3)
  })

  it('keeps personal memory but not the personal shelf in a solo project chat (ADR-0180, ADR-0193)', async () => {
    state.rows = [row({ projectId: 'p1' })]

    const context = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' })

    expect(context.may).toMatchObject({ personalMemory: true, personalShelf: false })
  })

  it('carries version null for a chat with no row yet, and treats it as the asker’s own', async () => {
    state.rows = [row({ exists: false, createdBy: null, version: null })]

    const context = await resolveConversationContext(session, { conversationId: 's_new', projectId: 'p_new', kind: 'chat' })

    expect(context.audience).toMatchObject({ solo: true, version: null })
    expect(context.projectId).toBe('p_new')
  })

  it('turns deep research and tasks off when the turn may draw on restricted folders, or the chat drew on any', async () => {
    state.rows = [row({ projectId: 'p1' })]
    const confined = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' })
    expect(confined.may.restrictedCollections).toEqual(['proj_p1_restricted'])
    expect(confined.may.projectMemory.readableFolderIds).toEqual(['folder:proj_p1_restricted'])
    expect(confined.may.features).toEqual({ deepResearch: false, tasks: false })

    state.rows = [row()]
    state.record = { folders: [], otherProjects: ['p_other'] }
    const recorded = await resolveConversationContext(session, { conversationId: 's_c', kind: 'chat' })
    expect(recorded.recorded.projects).toEqual(['p_other'])
    expect(recorded.may.features).toEqual({ deepResearch: false, tasks: false })
  })

  it('gives a run without a chat, a headless job and an external caller nothing personal', async () => {
    state.rows = [row({ projectId: 'p1' })]
    const run = await resolveConversationContext(session, { kind: 'run', projectId: 'p1' })
    const runInChat = await resolveConversationContext(session, { kind: 'run', conversationId: 's_c' })
    expect(runInChat.may).toMatchObject({ personalMemory: true, restrictedCollections: [] })
    const headless = await resolveConversationContext(session, { kind: 'headless', conversationId: 's_c', projectId: 'p1' })
    const external = await resolveConversationContext(session, { kind: 'external', conversationId: 's_c' })

    for (const context of [run, headless, external]) {
      expect(context.may).toMatchObject({ personalMemory: false, personalShelf: false })
    }
    expect(headless.may.shelves.map((entry) => entry.collection)).toEqual(['proj_p1'])
    expect(headless.may.workspaceRead).toBe('document+projectFacts')
    expect(headless.may.restrictedCollections).toEqual([])
    expect(external.conversationId).toBeNull()
  })

  it('narrows the document check, now headless, to its project and its conversation (#1909)', async () => {
    state.rows = [row({ projectId: 'p1' })]
    const asChat = await resolveConversationContext(session, { kind: 'chat', conversationId: 's_c' })
    const headless = await resolveConversationContext(session, { kind: 'headless', conversationId: 's_c' })

    expect(asChat.may.shelves.map((entry) => entry.shelf)).toEqual(['base', 'office_shelf', 'project', 'project', 'session'])
    expect(headless.conversationId).toBe('s_c')
    expect(headless.may.shelves).toEqual([{ collection: 'proj_p1', shelf: 'project' }])
    expect(headless.may).toMatchObject({
      restrictedCollections: [],
      personalMemory: false,
      otherProjects: { reach: 'none' },
      workspaceRead: 'document+projectFacts',
    })
  })

  it('gives a run the office shelf and its chat’s session collection, but never a restricted folder (#1909)', async () => {
    state.rows = [row({ projectId: 'p1' })]
    const run = await resolveConversationContext(session, { kind: 'run', conversationId: 's_c' })

    expect(run.may.shelves.map((entry) => entry.collection)).toEqual(['oib_knowledge', 'office_org_1', 'proj_p1', 's_s_c'])
    expect(run.may.restrictedCollections).toEqual([])
  })

  it('resolves only the scope for the socket upgrade: no record, entitlement or folder reads', async () => {
    state.rows = [row({ projectId: 'p1' })]

    const scope = await resolveConversationScope(session, { conversationId: 's_c', kind: 'chat' })

    expect(scope.shelves.map((entry) => entry.collection)).toContain('proj_p1')
    expect(conversationRecord).not.toHaveBeenCalled()
    expect(featureEntitlement).not.toHaveBeenCalled()
    expect(sourceFoldersOf).not.toHaveBeenCalled()
  })

  it('decides a run in its chat, reading the row once, and without it when the chat is in another project or in none', async () => {
    state.rows = [row({ projectId: 'p1' })]
    const inProject = await resolveRunConversationContext(session, { projectId: 'p1', conversationId: 's_c', kind: 'run' })
    expect(inProject.conversationId).toBe('s_c')
    expect(state.reads).toBe(1)

    for (const elsewhere of [row({ projectId: 'p2' }), row({ projectId: null })]) {
      state.rows = [elsewhere]
      state.reads = 0
      const run = await resolveRunConversationContext(session, { projectId: 'p1', conversationId: 's_c', kind: 'run' })
      expect(run.conversationId).toBeNull()
      expect(run.may.shelves.map((entry) => entry.collection)).not.toContain('s_s_c')
      expect(state.reads).toBe(1)
    }
  })

  it('decides no shelves and draws no restricted folder for the socket upgrade, which only authorizes', async () => {
    state.rows = [row({ projectId: 'p1' })]

    const scope = await resolveConversationScope(session, { conversationId: 's_c', kind: 'chat' }, { withoutShelves: true })

    expect(scope).toMatchObject({ projectId: 'p1', shelves: [], restrictedCollections: [] })
    expect(vi.mocked(buildCollectionScopeFromRequest).mock.calls[0]?.[1]).toMatchObject({ interactiveChat: false })
  })
})
