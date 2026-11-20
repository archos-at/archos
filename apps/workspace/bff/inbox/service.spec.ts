import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sharing/access', () => ({ resolveResourceAccess: vi.fn() }))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
vi.mock('@/lib/sharing/registry', () => ({ describeResource: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/tasks/subject-access', () => ({ unreadableRunIds: vi.fn() }))
vi.mock('@/lib/authz/platform', () => ({
  hasPlatformPermission: vi.fn(),
  getPlatformOrganizationId: vi.fn(),
}))
const laneScopes: string[] = []
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: vi.fn(async (scope: { organizationId: string }, fn: () => unknown) => {
    laneScopes.push(scope.organizationId)
    return await fn()
  }),
}))

vi.mock('./repository', () => ({
  INBOX_LIST_LIMIT: 50,
  listInboxItems: vi.fn(),
  countInboxFilters: vi.fn(async () => ({ requests: 0, unread: 0 })),
  markAnchorItemsRead: vi.fn(),
  markInboxItemsUnread: vi.fn(),
  unarchiveInboxItem: vi.fn(),
  countPendingInboxItems: vi.fn(),
  markInboxItemsRead: vi.fn(),
  markAllInboxItemsRead: vi.fn(),
  archiveInboxItem: vi.fn(),
  markResourceItemsRead: vi.fn(),
  markItemsInertAnchoredOn: vi.fn(),
  markItemsInertForResource: vi.fn(),
  markItemsInertForSubjectRow: vi.fn(),
  resolveInboxItemsForTargets: vi.fn(),
  resolveOpenItemsAnchoredOn: vi.fn(),
  upsertInboxItems: vi.fn(),
}))
vi.mock('@/lib/documents/can-write', () => ({ canWriteDocument: vi.fn() }))
vi.mock('@/lib/projects/repository', () => ({ listProjectNamesInOrg: vi.fn(async () => new Map()) }))

import { NotFoundError } from '@/lib/api/errors'
import { canWriteDocument } from '@/lib/documents/can-write'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveResourceAccess } from '@/lib/sharing/access'
import { resolvePeople } from '@/lib/sharing/directory'
import { describeResource } from '@/lib/sharing/registry'
import { unreadableRunIds } from '@/lib/tasks/subject-access'
import type { InboxItem } from '@/lib/db/schema/inbox'
import * as repository from './repository'
import { getInboxSummary, listInbox } from './service'
import { ALL_TYPES, at, featureGrants, makeSession, reachable, row, session } from './service.fixtures'

beforeEach(() => {
  vi.stubEnv('REQUIRE_AUTH', 'true')
  featureGrants.collaboration = true
  laneScopes.length = 0
  vi.mocked(hasPlatformPermission).mockResolvedValue(false)
  vi.mocked(getPlatformOrganizationId).mockResolvedValue('org_platform')
  vi.mocked(repository.listInboxItems).mockResolvedValue([])
  vi.mocked(repository.countPendingInboxItems).mockResolvedValue(3)
  vi.mocked(resolveResourceAccess).mockResolvedValue(reachable)
  vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-viewer' } as never)
  vi.mocked(unreadableRunIds).mockResolvedValue(new Set())
  vi.mocked(resolvePeople).mockResolvedValue(
    new Map([['user_2', { userId: 'user_2', email: 'anna@example.test', name: 'Anna Berger', profilePictureUrl: null }]]),
  )
  vi.mocked(describeResource).mockReturnValue({
    deepLink: (resourceId: string, options?: { anchorId?: string; projectId?: string | null }) =>
      `/app/projects/${options?.projectId}/chat?session=${resourceId}` +
      (options?.anchorId ? `#message-${options.anchorId}` : ''),
  } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('listInbox — read-time re-authorization (IB-13)', () => {
  it('redacts an inert row: no working link, no snippet', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ inertAt: at, payload: { subject: 'Brandschutz', excerpt: 'leaked text' } }),
    ])

    const { items } = await listInbox(session)

    expect(items[0]!.state).toBe('inert')
    expect(items[0]!.href).toBeNull()
    expect(items[0]!.excerpt).toBeNull()
    expect(resolveResourceAccess).not.toHaveBeenCalled()
  })

  it('redacts an unreachable target, and one unreachable target does not break the page', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'item_gone', resourceId: 'conv_gone' }),
      row({ id: 'item_ok', resourceId: 'conv_ok' }),
    ])
    vi.mocked(resolveResourceAccess).mockImplementation(async (_session, _type, resourceId) => {
      if (resourceId === 'conv_gone') throw new NotFoundError()
      return reachable
    })

    const { items } = await listInbox(session)

    const gone = items.find((item) => item.id === 'item_gone')!
    const ok = items.find((item) => item.id === 'item_ok')!
    expect(gone.href).toBeNull()
    expect(gone.excerpt).toBeNull()
    expect(gone.subject).toBeNull()
    expect(ok.href).toBe('/app/projects/proj_1/chat?session=conv_ok')
    expect(ok.excerpt).toBe('Welche OIB-2 Anforderung gilt hier?')
  })

  it('redacts when a probe fails unexpectedly, rather than failing the whole inbox', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([row()])
    vi.mocked(resolveResourceAccess).mockRejectedValue(new Error('database went away'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { items } = await listInbox(session)

    expect(items[0]!.href).toBeNull()
    expect(items[0]!.excerpt).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('treats "exists but you have no role" as unreachable', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([row()])
    vi.mocked(resolveResourceAccess).mockResolvedValue({ ...reachable, role: null, reason: null })

    const { items } = await listInbox(session)

    expect(items[0]!.href).toBeNull()
    expect(items[0]!.excerpt).toBeNull()
  })

  it('re-authorizes each DISTINCT target once, not once per item', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'a', resourceId: 'conv_1', anchorId: 'msg_1' }),
      row({ id: 'b', resourceId: 'conv_1', anchorId: 'msg_2' }),
      row({ id: 'c', resourceId: 'conv_1', anchorId: 'msg_3' }),
      row({ id: 'd', resourceId: 'conv_2' }),
    ])

    const { items } = await listInbox(session)

    expect(items).toHaveLength(4)
    expect(resolveResourceAccess).toHaveBeenCalledTimes(2)
    expect(vi.mocked(resolveResourceAccess).mock.calls.map((call) => call[2]).sort()).toEqual([
      'conv_1',
      'conv_2',
    ])
    expect(resolvePeople).toHaveBeenCalledTimes(1)
  })
})

describe('listInbox — projection', () => {
  it('states who, what, where and when on every row', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ type: 'mention.requested', actionable: true, anchorId: 'msg_7', count: 1 }),
    ])

    const { items, pending } = await listInbox(session)

    expect(items[0]).toMatchObject({
      type: 'mention.requested',
      state: 'unread',
      actionable: true,
      actorName: 'Anna Berger',
      actorUserId: 'user_2',
      href: '/app/projects/proj_1/chat?session=conv_1#message-msg_7',
      subject: 'Brandschutz Halle 3',
      createdAt: '2026-07-29T10:00:00.000Z',
    })
    expect(pending).toBe(3)
  })

  it('derives state strongest-fact-first (inert over archived over resolved over read)', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'r', readAt: at }),
      row({ id: 's', readAt: at, resolvedAt: at }),
      row({ id: 't', readAt: at, resolvedAt: at, archivedAt: at }),
      row({ id: 'u', readAt: at, resolvedAt: at, archivedAt: at, inertAt: at }),
    ])

    const { items } = await listInbox(session)

    expect(Object.fromEntries(items.map((item) => [item.id, item.state]))).toEqual({
      r: 'read',
      s: 'resolved',
      t: 'archived',
      u: 'inert',
    })
  })

  it('coerces attacker-influenced payload text instead of trusting its shape', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'junk', payload: { subject: 42, excerpt: { nested: true } } }),
      row({ id: 'padded', payload: { subject: '  spaced  ', excerpt: 'x'.repeat(2000) } }),
      row({ id: 'empty', payload: {} }),
    ])

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('junk')).toMatchObject({ subject: null, excerpt: null })
    expect(byId.get('padded')!.subject).toBe('spaced')
    expect(byId.get('padded')!.excerpt!.length).toBeLessThanOrEqual(501)
    expect(byId.get('empty')).toMatchObject({ subject: null, excerpt: null })
  })

  it('carries the excerpt\'s mentions as the bounded mention shape, withholds them when redacted, and drops junk', async () => {
    const anna = { targetId: 'user_anna', display: 'Anna Berger' }
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'ok', payload: { excerpt: '@Anna Berger bitte', mentions: [anna] } }),
      row({ id: 'inert', inertAt: at, payload: { excerpt: '@Anna Berger bitte', mentions: [anna] } }),
      row({ id: 'junk', payload: { excerpt: 'x', mentions: [{ targetId: 'user_anna', display: 'Anna', extra: '<b>' }] } }),
      row({ id: 'old', payload: { excerpt: 'x' } }),
    ])

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('ok')!.mentions).toEqual([anna])
    expect(byId.get('inert')!.mentions).toEqual([])
    expect(byId.get('junk')!.mentions).toEqual([])
    expect(byId.get('old')!.mentions).toEqual([])
  })

  it('carries the second name of a row (a new Fassung\'s newer document) and withholds it with the rest of the payload', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'ok', type: 'document.new_revision', resourceId: 'conv_ok', payload: { subject: 'Grundriss A', related: '  Grundriss B  ' } }),
      row({ id: 'junk', type: 'document.new_revision', resourceId: 'conv_ok', payload: { subject: 'Grundriss A', related: 42 } }),
      row({ id: 'inert', type: 'document.new_revision', inertAt: at, payload: { subject: 'Grundriss A', related: 'Grundriss B' } }),
      row({ id: 'gone', type: 'document.new_revision', resourceId: 'conv_gone', payload: { subject: 'Grundriss A', related: 'Grundriss B' } }),
    ])
    vi.mocked(resolveResourceAccess).mockImplementation(async (_session, _type, resourceId) => {
      if (resourceId === 'conv_gone') throw new NotFoundError()
      return reachable
    })

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('ok')).toMatchObject({ subject: 'Grundriss A', related: 'Grundriss B', actorName: 'Anna Berger' })
    expect(byId.get('junk')!.related).toBeNull()
    expect(byId.get('inert')!.related).toBeNull()
    expect(byId.get('gone')!.related).toBeNull()
  })

  it('carries which wording a row reads (why the agent could not work a mark) only as a key segment, and withholds it when redacted', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'ok', type: 'piloti.work_failed', resourceId: 'conv_ok', payload: { related: '4', variant: 'budget' } }),
      row({ id: 'path', type: 'piloti.work_failed', resourceId: 'conv_ok', payload: { variant: 'budget.body' } }),
      row({ id: 'junk', type: 'piloti.work_failed', resourceId: 'conv_ok', payload: { variant: 7 } }),
      row({ id: 'inert', type: 'piloti.work_failed', inertAt: at, payload: { variant: 'budget' } }),
      row({ id: 'gone', type: 'piloti.work_failed', resourceId: 'conv_gone', payload: { variant: 'budget' } }),
    ])
    vi.mocked(resolveResourceAccess).mockImplementation(async (_session, _type, resourceId) => {
      if (resourceId === 'conv_gone') throw new NotFoundError()
      return reachable
    })

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('ok')!.variant).toBe('budget')
    expect(byId.get('path')!.variant).toBeNull()
    expect(byId.get('junk')!.variant).toBeNull()
    expect(byId.get('inert')!.variant).toBeNull()
    expect(byId.get('gone')!.variant).toBeNull()
  })

  it('carries a mark’s date and a new Fassung’s open marks only in their shape, and withholds them when redacted', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'ok', resourceId: 'conv_ok', payload: { dueOn: '2026-10-24', openMarks: 4, marksRevision: 2 } }),
      row({ id: 'junk', resourceId: 'conv_ok', payload: { dueOn: '24.10.2026', openMarks: '4', marksRevision: 2.5 } }),
      row({ id: 'gone', resourceId: 'conv_gone', payload: { dueOn: '2026-10-24', openMarks: 4, marksRevision: 2 } }),
    ])
    vi.mocked(resolveResourceAccess).mockImplementation(async (_session, _type, resourceId) => {
      if (resourceId === 'conv_gone') throw new NotFoundError()
      return reachable
    })

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('ok')).toMatchObject({ dueOn: '2026-10-24', openMarks: 4, marksRevision: 2 })
    expect(byId.get('junk')).toMatchObject({ dueOn: null, openMarks: null, marksRevision: null })
    expect(byId.get('gone')).toMatchObject({ dueOn: null, openMarks: null, marksRevision: null })
  })

  it('opens a new edition’s norm in Normen & Richtlinien and carries what makes the edition binding', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({
        id: 'edition',
        type: 'base_knowledge.new_edition',
        resourceType: 'organization',
        resourceId: 'org_1',
        anchorId: 'önorm b 1600@2023-02-01',
        payload: { subject: 'ÖNORM B 1600', entryId: 'edition_1', related: '2023-02-01', via: 'OIB-RL 4 2023' },
      }),
      row({
        id: 'older',
        type: 'base_knowledge.new_edition',
        resourceType: 'organization',
        resourceId: 'org_1',
        anchorId: 'önorm b 1600@2023-02-01',
        payload: { subject: 'ÖNORM B 1600', related: '2023-02-01', via: 42 },
      }),
    ])

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('edition')).toMatchObject({ href: '/app/base-knowledge?entry=edition_1', via: 'OIB-RL 4 2023' })
    expect(byId.get('older')).toMatchObject({ href: '/app/base-knowledge', via: null })
  })

  it('carries an upload report only in its shape, and withholds it when redacted', async () => {
    const report = {
      projectId: 'proj-1',
      documents: 3,
      read: 3,
      byType: [{ type: 'submission_drawing', count: 3 }],
      facts: 1,
      factSamples: [{ key: 'storeys_above_ground', value: '4', unit: null }],
      newFindings: 1,
      findings: [{ kind: 'missing_document', key: 'soil_report', label: null, documents: 3 }],
      resolvedFindings: 0,
      unresolvedReferences: 1,
      pagesNotRead: 0,
      documentsNotFullyRead: 0,
    }
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'ok', resourceId: 'conv_ok', payload: { report } }),
      row({ id: 'junk', resourceId: 'conv_ok', payload: { report: { ...report, read: 'zwölf' } } }),
      row({ id: 'gone', resourceId: 'conv_gone', payload: { report } }),
    ])
    vi.mocked(resolveResourceAccess).mockImplementation(async (_session, _type, resourceId) => {
      if (resourceId === 'conv_gone') throw new NotFoundError()
      return reachable
    })

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('ok')?.uploadReport).toEqual(report)
    expect(byId.get('junk')?.uploadReport).toBeNull()
    expect(byId.get('gone')?.uploadReport).toBeNull()
  })

  it('leaves an unresolvable actor nameless rather than showing a raw user id', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([row({ actorUserId: 'user_deactivated' })])
    vi.mocked(resolvePeople).mockResolvedValue(new Map())

    const { items } = await listInbox(session)

    expect(items[0]!.actorName).toBeNull()
    expect(items[0]!.actorUserId).toBe('user_deactivated')
  })

  it('scopes the query to the caller and caps the page', async () => {
    await listInbox(session, { filter: 'pending' })

    expect(repository.listInboxItems).toHaveBeenCalledWith('org_1', 'user_1', {
      filter: 'pending',
      cursor: null,
      limit: 51,
      types: [...ALL_TYPES],
    })
  })

  it('keeps a read-but-unresolved actionable request in the pending page', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'req', type: 'mention.requested', actionable: true, anchorId: 'msg_7', readAt: at }),
    ])

    const { items } = await listInbox(session, { filter: 'pending' })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ state: 'read', actionable: true })
    expect(items[0]!.href).not.toBeNull()
  })
})

describe('listInbox — project href threads the delegated task', () => {
  it('lands on the task detail when the payload names taskId', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({
        id: 'job-done',
        type: 'task_run.completed',
        resourceType: 'project',
        resourceId: 'proj_1',
        anchorId: 'backend-job-1',
        payload: { subject: 'Wochenbericht', taskId: 'task-1', filedDocumentId: 'doc-9' },
      }),
    ])

    const { items } = await listInbox(session)

    expect(items[0]!.href).toBe('/app/projects/proj_1/automation?tab=tasks&task=task-1')
  })

  it('falls back to the automation page when taskId is absent or blank', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({
        id: 'job-no-task',
        type: 'task_run.completed',
        resourceType: 'project',
        resourceId: 'proj_1',
        anchorId: 'backend-job-1',
        payload: { subject: 'Wochenbericht', taskId: null, filedDocumentId: null },
      }),
      row({
        id: 'job-blank-task',
        type: 'task_run.failed',
        resourceType: 'project',
        resourceId: 'proj_1',
        anchorId: 'backend-job-2',
        payload: { subject: 'Nachtlauf', taskId: '   ' },
      }),
    ])

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get('job-no-task')!.href).toBe('/app/projects/proj_1/automation?tab=jobs')
    expect(byId.get('job-blank-task')!.href).toBe('/app/projects/proj_1/automation?tab=jobs')
  })

  it('redacts a run row whose task the recipient may not see now, by the run it names', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({
        id: 'revision-done',
        type: 'task_run.completed',
        resourceType: 'project',
        resourceId: 'proj_1',
        anchorId: 'backend-job-1',
        payload: {
          subject: 'Überarbeitung: Honorar Zimmerer',
          runId: 'run-revision',
          taskId: 'run-revision',
          conversationId: 's_thread',
          runMessageId: 'msg-1',
        },
      }),
      row({
        id: 'plain-done',
        type: 'task_run.completed',
        resourceType: 'project',
        resourceId: 'proj_1',
        anchorId: 'backend-job-2',
        payload: { subject: 'Aktenvermerk', taskId: 'run-plain' },
      }),
    ])
    vi.mocked(unreadableRunIds).mockResolvedValue(new Set(['run-revision']))

    const { items } = await listInbox(session)
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(unreadableRunIds).toHaveBeenCalledWith(session, [
      { projectId: 'proj_1', runId: 'run-revision' },
      { projectId: 'proj_1', runId: 'run-plain' },
    ])
    expect(byId.get('revision-done')).toMatchObject({ href: null, subject: null, excerpt: null })
    expect(byId.get('plain-done')).toMatchObject({
      href: '/app/projects/proj_1/automation?tab=tasks&task=run-plain',
      subject: 'Aktenvermerk',
    })
  })
})

describe('getInboxSummary', () => {
  it('is one count and nothing else — it runs on every page render', async () => {
    expect(await getInboxSummary(session)).toEqual({ pending: 3 })

    expect(repository.countPendingInboxItems).toHaveBeenCalledWith('org_1', 'user_1', [
      ...ALL_TYPES,
    ])
    expect(repository.listInboxItems).not.toHaveBeenCalled()
    expect(resolveResourceAccess).not.toHaveBeenCalled()
    expect(resolvePeople).not.toHaveBeenCalled()
  })
})

describe('listInbox — where a request on a mark may be answered (answerIn)', () => {
  const onMark = (overrides: Partial<InboxItem>) =>
    row({
      type: 'annotation.assigned_to_you',
      resourceType: 'document',
      resourceId: 'doc_w',
      anchorId: 'ann_1',
      actionable: true,
      groupKey: 'annotation.assigned_to_you:document:doc_w:ann_1',
      ...overrides,
    })

  beforeEach(() => {
    vi.mocked(canWriteDocument).mockImplementation(async (_session, documentId) => documentId === 'doc_w')
  })

  it('offers the row to a reader who may write the document, and nothing to one who may only read it', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      onMark({ id: 'writer' }),
      onMark({ id: 'reader', resourceId: 'doc_r', groupKey: 'g_r' }),
      onMark({ id: 'mentioned', type: 'annotation.mentioned', groupKey: 'g_m' }),
      onMark({ id: 'mentionedReader', type: 'annotation.mentioned', resourceId: 'doc_r', groupKey: 'g_mr' }),
    ])

    const { items } = await listInbox(session)

    expect(Object.fromEntries(items.map((item) => [item.id, item.answerIn]))).toEqual({
      writer: 'row',
      reader: null,
      mentioned: 'row',
      mentionedReader: null,
    })
    expect(vi.mocked(canWriteDocument).mock.calls.map(([, documentId]) => documentId).sort()).toEqual(['doc_r', 'doc_w'])
  })

  it('sends the agent’s Rückfrage to the Prüfansicht while events do not wake the agent, and keeps it in the row when they do', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([onMark({ id: 'asks', type: 'piloti.asks_you' })])

    expect((await listInbox(session)).items[0]!.answerIn).toBe('review')

    const wakes = makeSession({ featureFlags: ['collaboration', 'agent-thread-replies'] })
    expect((await listInbox(wakes)).items[0]!.answerIn).toBe('row')
  })

  it('lets an answer from the row address the agent only where events wake it, and only where the row answers', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      onMark({ id: 'writer' }),
      onMark({ id: 'reader', resourceId: 'doc_r', groupKey: 'g_r' }),
    ])

    const off = await listInbox(session)
    expect(off.items.map((item) => [item.id, item.pilotiWakes])).toEqual([
      ['writer', false],
      ['reader', false],
    ])

    const on = await listInbox(makeSession({ featureFlags: ['collaboration', 'agent-thread-replies'] }))
    expect(on.items.map((item) => [item.id, item.pilotiWakes])).toEqual([
      ['writer', true],
      ['reader', false],
    ])
  })

  it('asks nothing for a row that is no request on a mark, and offers nothing on an unreachable one', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      row({ id: 'chat' }),
      onMark({ id: 'fyi', type: 'annotation.activity', actionable: false, groupKey: 'g_a' }),
      onMark({ id: 'gone', inertAt: at, groupKey: 'g_g' }),
    ])

    const { items } = await listInbox(session)

    expect(items.map((item) => item.answerIn)).toEqual([null, null, null])
    expect(canWriteDocument).not.toHaveBeenCalled()
  })
})
