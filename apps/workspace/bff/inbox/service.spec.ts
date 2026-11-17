import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sharing/access', () => ({ resolveResourceAccess: vi.fn() }))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
vi.mock('@/lib/sharing/registry', () => ({ describeResource: vi.fn() }))
vi.mock('@/lib/push/enqueue', () => ({ enqueueInboxPushes: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/events/bus', () => ({ publishToUser: vi.fn().mockResolvedValue(undefined) }))
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

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/documents/can-write', () => ({ canWriteDocument: vi.fn() }))
vi.mock('@/lib/projects/repository', () => ({ listProjectNamesInOrg: vi.fn(async () => new Map()) }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { canWriteDocument } from '@/lib/documents/can-write'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboxItem, InboxItemType } from '@/lib/db/schema/inbox'
import { getDb } from '@/lib/db'
import { publishToUser } from '@/lib/events/bus'
import { enqueueInboxPushes } from '@/lib/push/enqueue'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getPlatformOrganizationId, hasPlatformPermission } from '@/lib/authz/platform'
import { resolveResourceAccess } from '@/lib/sharing/access'
import { resolvePeople } from '@/lib/sharing/directory'
import { describeResource } from '@/lib/sharing/registry'
import { unreadableRunIds } from '@/lib/tasks/subject-access'
import * as repository from './repository'
import {
  upsertWaves,
  emitInboxItems,
  resolveInboxItemsAnchoredOn,
  markInboxItemsInertAnchoredOn,
  archiveItem,
  getInboxSummary,
  listInbox,
  markAllRead,
  markRead,
  markResourceItemsReadFor,
  markAnchorItemsReadFor,
  markMarksSetReadFor,
  markUnread,
  unarchiveItem,
  decodeInboxCursor,
  encodeInboxCursor,
  viewInboxItemAs,
} from './service'
import { BadRequestError } from '@/lib/api/errors'

let collaborationGranted = true

function makeSession(overrides: Partial<AuthorizedSession> = {}): AuthorizedSession {
  return {
    userId: 'user_1',
    email: 'user_1@example.test',
    name: 'Test User',
    accessToken: 'workos_token',
    organizationId: 'org_1',
    organizationMembershipId: 'om_1',
    role: 'admin',
    permissions: [],
    get featureFlags() {
      return collaborationGranted ? ['collaboration'] : []
    },
    ...overrides,
  }
}

const session = makeSession()

const ALL_TYPES = [
  'mention.requested',
  'mention.answered',
  'conversation.shared_with_you',
  'conversation.activity',
  'storage.quota_warning',
  'document.assigned_to_you',
  'resource.ownership_taken',
  'task_run.completed',
  'task_run.failed',
  'task_run.waiting',
  'document.review_requested',
  'feedback.replied',
  'upload.completed',
  'document.quarantined',
  'document.release_requested',
  'mail_import.completed',
  'mail_import.failed',
  'document.new_revision',
  'piloti.work_done',
  'piloti.work_failed',
  'piloti.asks_you',
  'piloti.proposal_waiting',
  'piloti.intake_ready',
  'piloti.revision_checked',
  'annotation.assigned_to_you',
  'annotation.activity',
  'annotation.mentioned',
  'root_sort.ready',
  'root_sort.failed',
  'inbound_mail.waiting',
  'inbound_mail.expiring',
  'inbound_mail.decided',
  'inbound_mail.filing_failed',
  'inbound_mail.cap_reached',
  'inbound_mail.appended',
  'mail_thread.follow_expiring',
  'inbound_mail.held',
  'inbound_mail.held_for_writers',
  'inbound_mail.rejected',
  'inbound_mail.expired',
] as const satisfies readonly InboxItemType[]

const OPERATIONAL_TYPES = [
  'storage.quota_warning',
  'task_run.completed',
  'task_run.failed',
  'task_run.waiting',
  'document.review_requested',
  'feedback.replied',
  'upload.completed',
  'document.quarantined',
  'document.release_requested',
  'mail_import.completed',
  'mail_import.failed',
  'document.new_revision',
  'piloti.work_done',
  'piloti.work_failed',
  'piloti.asks_you',
  'piloti.proposal_waiting',
  'piloti.intake_ready',
  'piloti.revision_checked',
  'annotation.assigned_to_you',
  'annotation.activity',
  'annotation.mentioned',
  'root_sort.ready',
  'root_sort.failed',
  'inbound_mail.waiting',
  'inbound_mail.expiring',
  'inbound_mail.decided',
  'inbound_mail.filing_failed',
  'inbound_mail.cap_reached',
  'inbound_mail.appended',
  'mail_thread.follow_expiring',
  'inbound_mail.held',
  'inbound_mail.held_for_writers',
  'inbound_mail.rejected',
  'inbound_mail.expired',
] as const satisfies readonly InboxItemType[]

const at = new Date('2026-07-29T10:00:00.000Z')

function row(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item_1',
    organizationId: 'org_1',
    recipientUserId: 'user_1',
    type: 'conversation.activity',
    resourceType: 'conversation',
    resourceId: 'conv_1',
    anchorId: null,
    actorUserId: 'user_2',
    groupKey: 'conversation.activity:conversation:conv_1',
    actionable: false,
    count: 1,
    payload: { subject: 'Brandschutz Halle 3', excerpt: 'Welche OIB-2 Anforderung gilt hier?' },
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: null,
    archivedAt: null,
    inertAt: null,
    ...overrides,
  }
}

const reachable = {
  role: 'collaborator' as const,
  reason: 'visibility-project' as const,
  visibility: 'project' as const,
  container: { organizationId: 'org_1', projectId: 'proj_1' },
  canEscalate: false,
  contentLocked: false,
}

beforeEach(() => {
  vi.stubEnv('REQUIRE_AUTH', 'true')
  collaborationGranted = true
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

  it('carries which wording a row reads (why Piloti could not work a mark) only as a key segment, and withholds it when redacted', async () => {
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

describe('mutations are scoped to the caller\'s own inbox', () => {
  it('marks read with the caller\'s user + organization, so foreign ids match nothing', async () => {
    vi.mocked(repository.markInboxItemsRead).mockResolvedValue(0)

    const result = await markRead(session, ['item_of_another_user'])

    expect(repository.markInboxItemsRead).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      ['item_of_another_user'],
      [...ALL_TYPES],
    )
    expect(result).toEqual({ affected: 0, pending: 3 })
  })

  it('publishes the recomputed badge count after marking read', async () => {
    vi.mocked(repository.markInboxItemsRead).mockResolvedValue(2)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(1)

    const result = await markRead(session, ['item_1', 'item_2'])

    expect(result).toEqual({ affected: 2, pending: 1 })
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 1 })
  })

  it('marks everything read for the caller only', async () => {
    vi.mocked(repository.markAllInboxItemsRead).mockResolvedValue(5)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(0)

    expect(await markAllRead(session)).toEqual({ affected: 5, pending: 0 })
    expect(repository.markAllInboxItemsRead).toHaveBeenCalledWith('org_1', 'user_1', [
      ...ALL_TYPES,
    ])
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 0 })
  })

  it('answers 404 for archiving an item that is not the caller\'s', async () => {
    vi.mocked(repository.archiveInboxItem).mockResolvedValue(false)

    await expect(archiveItem(session, 'item_of_another_user')).rejects.toBeInstanceOf(NotFoundError)

    expect(repository.archiveInboxItem).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'item_of_another_user',
      [...ALL_TYPES],
    )
    expect(publishToUser).not.toHaveBeenCalled()
  })

  it('narrows both mutations to the types the caller may see', async () => {
    collaborationGranted = false
    vi.mocked(repository.markInboxItemsRead).mockResolvedValue(0)
    vi.mocked(repository.archiveInboxItem).mockResolvedValue(false)

    await markRead(session, ['collab_item'])
    const readScope = vi.mocked(repository.markInboxItemsRead).mock.calls[0]![3]
    expect(readScope).not.toContain('mention.requested')
    expect(readScope).toContain('storage.quota_warning')

    await expect(archiveItem(session, 'collab_item')).rejects.toBeInstanceOf(NotFoundError)
    const archiveScope = vi.mocked(repository.archiveInboxItem).mock.calls[0]![3]
    expect(archiveScope).toEqual(readScope)
  })

  it('archives the caller\'s own item and refreshes the badge', async () => {
    vi.mocked(repository.archiveInboxItem).mockResolvedValue(true)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(2)

    expect(await archiveItem(session, 'item_1')).toEqual({ affected: 1, pending: 2 })
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 2 })
  })

  it('clears a resource\'s items for the caller when they open it (IB-9)', async () => {
    vi.mocked(repository.markResourceItemsRead).mockResolvedValue(4)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(1)

    const result = await markResourceItemsReadFor(session, 'conversation', 'conv_1')

    expect(repository.markResourceItemsRead).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'conversation',
      'conv_1',
    )
    expect(result).toEqual({ affected: 4, pending: 1 })
  })
})

describe('the reader’s own read state and archive', () => {
  it('marks items unread for the caller only, in the types they may see, and refreshes the badge', async () => {
    vi.mocked(repository.markInboxItemsUnread).mockResolvedValue(1)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(4)

    expect(await markUnread(session, ['item_1'])).toEqual({ affected: 1, pending: 4 })
    expect(repository.markInboxItemsUnread).toHaveBeenCalledWith('org_1', 'user_1', ['item_1'], [...ALL_TYPES])
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 4 })
  })

  it('restores an archived item, and answers 404 for one that is not the caller’s', async () => {
    vi.mocked(repository.unarchiveInboxItem).mockResolvedValueOnce(true)
    expect(await unarchiveItem(session, 'item_1')).toEqual({ affected: 1, pending: 3 })
    expect(repository.unarchiveInboxItem).toHaveBeenCalledWith('org_1', 'user_1', 'item_1', [...ALL_TYPES])

    vi.mocked(repository.unarchiveInboxItem).mockResolvedValueOnce(false)
    await expect(unarchiveItem(session, 'item_of_another_user')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('reads the news about one mark when the caller opens it, in the types they may see', async () => {
    vi.mocked(repository.markAnchorItemsRead).mockResolvedValue(2)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(1)

    expect(await markAnchorItemsReadFor(session, 'document', 'doc_1', 'mark_4')).toEqual({ affected: 2, pending: 1 })
    expect(repository.markAnchorItemsRead).toHaveBeenCalledWith('org_1', 'user_1', 'document', 'doc_1', 'mark_4', [
      ...ALL_TYPES,
    ])
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 1 })
  })

  it('reads the rows about new marks when the caller opens the document’s review, and only those', async () => {
    vi.mocked(repository.markResourceItemsRead).mockResolvedValue(1)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(0)

    expect(await markMarksSetReadFor(session, 'document', 'doc_1')).toEqual({ affected: 1, pending: 0 })
    expect(repository.markResourceItemsRead).toHaveBeenCalledWith('org_1', 'user_1', 'document', 'doc_1', {
      groupAnchor: 'set:',
      types: [...ALL_TYPES],
    })
    expect(publishToUser).toHaveBeenCalledWith('user_1', { kind: 'inbox.changed', pending: 0 })
  })

  it('nudges nobody when the mark had no news: every open inbox would re-read for nothing', async () => {
    vi.mocked(repository.markAnchorItemsRead).mockResolvedValue(0)
    vi.mocked(repository.countPendingInboxItems).mockResolvedValue(4)

    expect(await markAnchorItemsReadFor(session, 'document', 'doc_1', 'mark_4')).toEqual({ affected: 0, pending: 4 })
    expect(publishToUser).not.toHaveBeenCalled()
  })
})

describe('listInbox — one page at a time', () => {
  const stamp = (minute: number) => new Date(`2026-10-01T10:${String(minute).padStart(2, '0')}:00.000Z`)
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  it('says there is more when a lane returned past the page, and where the next page starts, to the microsecond', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue(
      Array.from({ length: 51 }, (_, n) => ({
        ...row({ id: id(n), updatedAt: stamp(59 - n) }),
        listedAtMicros: String(BigInt(stamp(59 - n).getTime()) * BigInt(1000) + BigInt(7)),
      })),
    )

    const page = await listInbox(session, { filter: 'requests' })

    expect(page.items).toHaveLength(50)
    expect(page.hasMore).toBe(true)
    expect(decodeInboxCursor(page.nextCursor as string)).toEqual({
      micros: String(BigInt(stamp(10).getTime()) * BigInt(1000) + BigInt(7)),
      id: id(49),
    })
    expect(repository.listInboxItems).toHaveBeenCalledWith('org_1', 'user_1', expect.objectContaining({ filter: 'requests', limit: 51 }))
  })

  it('merges lanes by the stored microsecond, not the millisecond a Date keeps', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    const sameMillisecond = stamp(30)
    vi.mocked(repository.listInboxItems).mockImplementation(async (organizationId) =>
      organizationId !== 'org_platform'
        ? [{ ...row({ id: id(1), updatedAt: sameMillisecond }), listedAtMicros: String(BigInt(sameMillisecond.getTime()) * BigInt(1000) + BigInt(100)) }]
        : [{ ...row({ id: id(2), type: 'feedback.submitted', updatedAt: sameMillisecond }), listedAtMicros: String(BigInt(sameMillisecond.getTime()) * BigInt(1000) + BigInt(900)) }],
    )

    const { items } = await listInbox(session)

    expect(items.map((item) => item.id)).toEqual([id(2), id(1)])
  })

  it('says there is no more on the last page, and reads after the cursor it is given', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([row()])
    const cursor = encodeInboxCursor({ micros: '1790848800123456', id: id(7) })

    const page = await listInbox(session, { cursor })

    expect(page).toMatchObject({ hasMore: false, nextCursor: null })
    expect(repository.listInboxItems).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      expect.objectContaining({ cursor: { micros: '1790848800123456', id: id(7) } }),
    )
  })

  it('refuses a cursor it did not write', async () => {
    expect(() => decodeInboxCursor('not-a-cursor')).toThrow(BadRequestError)
    expect(() => decodeInboxCursor(Buffer.from('2026-10-01T10:00:00.000Z|' + id(1)).toString('base64url'))).toThrow(BadRequestError)
    expect(() => decodeInboxCursor(Buffer.from('123|x').toString('base64url'))).toThrow(BadRequestError)
  })

  it('carries the numbers beside the filters, and whether each row is archived', async () => {
    vi.mocked(repository.countInboxFilters).mockResolvedValue({ requests: 2, unread: 5 })
    vi.mocked(repository.listInboxItems).mockResolvedValue([row({ id: 'a', archivedAt: at, inertAt: at })])
    const page = await listInbox(session, { filter: 'archived' })
    expect(page.counts).toEqual({ requests: 2, unread: 5 })
    expect(page.items[0]).toMatchObject({ state: 'inert', archived: true })
  })
})

describe('the SQL predicates behind the filters', () => {
  function render(condition: unknown): { sql: string; params: unknown[] } {
    const query = new PgDialect().sqlToQuery(condition as never)
    return { sql: query.sql, params: query.params }
  }

  async function realRepository() {
    return vi.importActual<typeof import('./repository')>('./repository')
  }

  it('the pending filter keeps unresolved actionable requests but drops read informational ones', async () => {
    let condition: unknown
    const limit = vi.fn().mockResolvedValue([])
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn((value: unknown) => {
      condition = value
      return { orderBy }
    })
    vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })) } as never)

    const real = await realRepository()
    await real.listInboxItems('org_1', 'user_1', {
      filter: 'pending',
      types: real.EVERY_INBOX_TYPE,
    })
    const { sql, params } = render(condition)

    expect(sql).toContain('"inbox_items"."organization_id" = $1')
    expect(sql).toContain('"inbox_items"."recipient_user_id" = $2')
    expect(sql).toContain('"inbox_items"."archived_at" is null')
    expect(sql).toContain('"inbox_items"."inert_at" is null')
    expect(sql).toContain(
      '"inbox_items"."read_at" is null or ("inbox_items"."actionable" = $3 and "inbox_items"."resolved_at" is null)',
    )
    expect(params).toEqual(['org_1', 'user_1', true])
  })

  it('resolves a settled request for ITS recipient only, never a colleague sharing the group key', async () => {
    let condition: unknown
    const returning = vi.fn().mockResolvedValue([])
    const where = vi.fn((value: unknown) => {
      condition = value
      return { returning }
    })
    vi.mocked(getDb).mockReturnValue({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    } as never)

    const real = await realRepository()
    await real.resolveInboxItemsForTargets([
      {
        organizationId: 'org_1',
        recipientUserId: 'user_anna',
        groupKey: 'mention.requested:conversation:conv_1:msg_1',
      },
    ])
    const { sql, params } = render(condition)

    expect(sql).toContain('"inbox_items"."organization_id" = ')
    expect(sql).toContain('"inbox_items"."recipient_user_id" = ')
    expect(sql).toContain('"inbox_items"."resolved_at" is null')
    expect(params).toEqual([
      'org_1',
      'user_anna',
      'mention.requested:conversation:conv_1:msg_1',
    ])
  })

  it('marking a resource read clears ambient items only, never actionable ones', async () => {
    let condition: unknown
    const returning = vi.fn().mockResolvedValue([])
    const where = vi.fn((value: unknown) => {
      condition = value
      return { returning }
    })
    vi.mocked(getDb).mockReturnValue({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    } as never)

    const real = await realRepository()
    await real.markResourceItemsRead('org_1', 'user_1', 'conversation', 'conv_1')
    const { sql, params } = render(condition)

    expect(sql).toContain('"inbox_items"."actionable" = $5')
    expect(sql).toContain('"inbox_items"."read_at" is null')
    expect(params).toEqual(['org_1', 'user_1', 'conversation', 'conv_1', false])
  })
})

describe('visibleInboxTypes gate — the inbox is not collaboration-only', () => {
  it('a tenant WITHOUT collaboration still sees operational items', async () => {
    collaborationGranted = false

    await listInbox(makeSession())

    expect(repository.listInboxItems).toHaveBeenCalledWith('org_1', 'user_1', {
      filter: 'all',
      cursor: null,
      limit: 51,
      types: [...OPERATIONAL_TYPES],
    })
  })

  it('a tenant WITHOUT collaboration gets a badge counted over the same set', async () => {
    collaborationGranted = false

    await getInboxSummary(makeSession())

    expect(repository.countPendingInboxItems).toHaveBeenCalledWith('org_1', 'user_1', [
      ...OPERATIONAL_TYPES,
    ])
  })

  it('a tenant WITH collaboration sees every registered type', async () => {
    await listInbox(makeSession())

    expect(repository.listInboxItems).toHaveBeenCalledWith('org_1', 'user_1', {
      filter: 'all',
      cursor: null,
      limit: 51,
      types: [...ALL_TYPES],
    })
  })

  it('"clear all" without collaboration cannot settle collaboration rows', async () => {
    collaborationGranted = false
    vi.mocked(repository.markAllInboxItemsRead).mockResolvedValue(1)

    await markAllRead(makeSession())

    const [, , types] = vi.mocked(repository.markAllInboxItemsRead).mock.calls[0]!
    expect(types).toEqual([...OPERATIONAL_TYPES])
    expect(types).not.toContain('mention.requested')
  })
})

describe('the platform lane', () => {
  const feedbackRow = row({
    id: 'item_feedback',
    organizationId: 'org_platform',
    type: 'feedback.submitted',
    resourceType: 'product_feedback',
    resourceId: 'report_1',
    actorUserId: 'user_elsewhere',
    groupKey: 'feedback.submitted:product_feedback:report_1',
    payload: { subject: 'Büro Nord', excerpt: 'Upload hängt', actorName: 'Maria Huber' },
    updatedAt: new Date('2026-07-29T11:00:00.000Z'),
  })

  function listByOrganization(tenantRows: InboxItem[], platformRows: InboxItem[]) {
    vi.mocked(repository.listInboxItems).mockImplementation(async (organizationId) =>
      organizationId === 'org_platform' ? platformRows : tenantRows,
    )
  }

  it('stays shut for a reader without the platform permission', async () => {
    listByOrganization([row()], [feedbackRow])

    const { items } = await listInbox(session)

    expect(items.map((item) => item.id)).toEqual(['item_1'])
    expect(laneScopes).toEqual([])
    expect(vi.mocked(repository.listInboxItems).mock.calls.map((call) => call[0])).toEqual(['org_1'])
  })

  it('merges platform rows into the list, newest first, queried AS the platform organization', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    listByOrganization([row()], [feedbackRow])

    const { items } = await listInbox(session)

    expect(items.map((item) => item.id)).toEqual(['item_feedback', 'item_1'])
    expect(laneScopes.length).toBeGreaterThan(0)
    expect(new Set(laneScopes)).toEqual(new Set(['org_platform']))
    const platformCall = vi
      .mocked(repository.listInboxItems)
      .mock.calls.find((call) => call[0] === 'org_platform')!
    expect(platformCall[1]).toBe('user_1')
    expect(platformCall[2].types).toEqual(['feedback.submitted'])
  })

  it('links the report and names its author from the payload snapshot', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    listByOrganization([], [feedbackRow])

    const { items } = await listInbox(session)

    expect(items[0]!.href).toBe('/app/platform/feedback?report=report_1')
    expect(items[0]!.actorName).toBe('Maria Huber')
    expect(items[0]!.excerpt).toBe('Upload hängt')
  })

  it('never asks the tenant lane for a platform type, so no row is listed twice', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    const insidePlatform = makeSession({ organizationId: 'org_platform' })

    await listInbox(insidePlatform)

    const typeSets = vi.mocked(repository.listInboxItems).mock.calls.map((call) => call[2].types)
    expect(typeSets).toHaveLength(2)
    const [tenant, platform] = typeSets as InboxItemType[][]
    expect(tenant).not.toContain('feedback.submitted')
    expect(platform).toEqual(['feedback.submitted'])
  })

  it('counts both lanes in the badge', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    vi.mocked(repository.countPendingInboxItems).mockImplementation(async (organizationId) =>
      organizationId === 'org_platform' ? 2 : 3,
    )

    expect(await getInboxSummary(session)).toEqual({ pending: 5 })
  })

  it('archives a platform row through its own lane', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    vi.mocked(repository.archiveInboxItem).mockImplementation(
      async (organizationId) => organizationId === 'org_platform',
    )

    const result = await archiveItem(session, 'item_feedback')

    expect(result.affected).toBe(1)
  })

  it('stays shut when the platform organization is not provisioned', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    vi.mocked(getPlatformOrganizationId).mockResolvedValue(null)

    await getInboxSummary(session)

    expect(vi.mocked(repository.countPendingInboxItems).mock.calls.map((call) => call[0])).toEqual([
      'org_1',
    ])
  })
})

describe('emitInboxItems — repeated keys in one call', () => {
  it('splits rows so no wave repeats a (recipient, group) key, keeping order', () => {
    const row = (recipientUserId: string, groupKey: string, n: number) => ({ recipientUserId, groupKey, n })
    const waves = upsertWaves([row('a', 'g', 1), row('b', 'g', 2), row('a', 'g', 3), row('a', 'g', 4), row('a', 'h', 5)])
    expect(waves.map((wave) => wave.map((r) => r.n))).toEqual([[1, 2, 5], [3], [4]])
  })

  it('upserts each wave on its own', async () => {
    vi.mocked(repository.upsertInboxItems).mockResolvedValue([])
    const emission = {
      organizationId: 'org-1',
      recipientUserId: 'reviewer',
      type: 'document.quarantined' as const,
      resourceType: 'organization' as const,
      resourceId: 'org-1',
      actorUserId: 'uploader',
      groupKey: 'document.quarantined:organization:org-1',
    }
    await emitInboxItems([emission, emission])
    expect(repository.upsertInboxItems).toHaveBeenCalledTimes(2)
  })

  it('writes one emission that stands for several occurrences as one row counting them all', async () => {
    vi.mocked(repository.upsertInboxItems).mockResolvedValue([])
    const emission = {
      organizationId: 'org-1',
      recipientUserId: 'lead',
      type: 'annotation.activity' as const,
      resourceType: 'document' as const,
      resourceId: 'doc-1',
      anchorId: 'ann-15',
      actorUserId: 'miriam',
      groupKey: 'annotation.activity:document:doc-1:set:created:miriam',
    }
    await emitInboxItems([{ ...emission, occurrences: 15 }, { ...emission, recipientUserId: 'uploader' }])

    expect(repository.upsertInboxItems).toHaveBeenCalledTimes(1)
    expect(vi.mocked(repository.upsertInboxItems).mock.calls[0]?.[0].map((row) => [row.recipientUserId, row.count])).toEqual([
      ['lead', 15],
      ['uploader', 1],
    ])
  })
})

describe('resolveInboxItemsAnchoredOn', () => {
  it('resolves through the repository and nudges each person whose badge moved, once', async () => {
    vi.mocked(repository.resolveOpenItemsAnchoredOn).mockResolvedValue(['user_a', 'user_b'])
    vi.mocked(publishToUser).mockClear()

    const input = { organizationId: 'org_1', types: ['piloti.asks_you'] as InboxItemType[], anchorId: 'ann_1' }
    expect(await resolveInboxItemsAnchoredOn(input)).toBe(2)

    expect(repository.resolveOpenItemsAnchoredOn).toHaveBeenCalledWith(input)
    expect(publishToUser).toHaveBeenCalledTimes(2)
    expect(publishToUser).toHaveBeenCalledWith('user_a', { kind: 'inbox.changed', pending: -1 })
  })

  it('nudges nobody when nothing was open', async () => {
    vi.mocked(repository.resolveOpenItemsAnchoredOn).mockResolvedValue([])
    vi.mocked(publishToUser).mockClear()

    expect(
      await resolveInboxItemsAnchoredOn({ organizationId: 'org_1', types: ['piloti.asks_you'], anchorId: 'ann_1' }),
    ).toBe(0)
    expect(publishToUser).not.toHaveBeenCalled()
  })
})

describe('markInboxItemsInertAnchoredOn', () => {
  it('turns the rows inert through the repository and nudges each person whose badge moved', async () => {
    vi.mocked(repository.markItemsInertAnchoredOn).mockResolvedValue(['user_a', 'user_b'])
    vi.mocked(publishToUser).mockClear()

    const input = { organizationId: 'org_1', types: ['annotation.activity'] as InboxItemType[], anchorId: 'ann_1' }
    expect(await markInboxItemsInertAnchoredOn(input)).toBe(2)

    expect(repository.markItemsInertAnchoredOn).toHaveBeenCalledWith(input)
    expect(publishToUser).toHaveBeenCalledTimes(2)
    expect(publishToUser).toHaveBeenCalledWith('user_b', { kind: 'inbox.changed', pending: -1 })
  })
})

describe('emitInboxItems — system notifications (ADR-0112)', () => {
  const emission = {
    organizationId: 'org_1',
    recipientUserId: 'user_1',
    type: 'mention.requested' as const,
    resourceType: 'conversation' as const,
    resourceId: 'conv_1',
    anchorId: 'm1',
    actorUserId: 'user_2',
    groupKey: 'mention.requested:conversation:conv_1:m1',
  }

  it('hands the stored rows to the push queue, after they are stored', async () => {
    const stored = row({ id: 'stored', type: 'mention.requested' })
    vi.mocked(repository.upsertInboxItems).mockResolvedValue([stored])
    vi.mocked(enqueueInboxPushes).mockClear()
    await emitInboxItems([emission])
    expect(enqueueInboxPushes).toHaveBeenCalledWith([stored])
  })

  it('does not queue a push for a notification about one’s own action', async () => {
    vi.mocked(enqueueInboxPushes).mockClear()
    await emitInboxItems([{ ...emission, actorUserId: 'user_1' }])
    expect(enqueueInboxPushes).not.toHaveBeenCalled()
  })
})

describe('viewInboxItemAs — the row as its recipient would be shown it', () => {
  it('words a reachable item with its address', async () => {
    const view = await viewInboxItemAs(session, row({ type: 'mention.requested', groupKey: 'g', anchorId: 'm1' }))
    expect(view?.href).toBe('/app/projects/proj_1/chat?session=conv_1#message-m1')
    expect(view?.actorName).toBe('Anna Berger')
  })

  it('answers null when the target is no longer reachable', async () => {
    vi.mocked(resolveResourceAccess).mockRejectedValue(new NotFoundError())
    expect(await viewInboxItemAs(session, row())).toBeNull()
  })

  it('answers null for an inert item', async () => {
    expect(await viewInboxItemAs(session, row({ inertAt: at }))).toBeNull()
  })

  it('answers null for a type the recipient’s organization may not see', async () => {
    collaborationGranted = false
    expect(await viewInboxItemAs(session, row({ type: 'mention.requested' }))).toBeNull()
  })

  it('answers null for a run the recipient may not read', async () => {
    vi.mocked(unreadableRunIds).mockResolvedValue(new Set(['run_1']))
    const project = row({
      type: 'task_run.completed',
      resourceType: 'project',
      resourceId: 'proj_1',
      payload: { runId: 'run_1', subject: 'Auftrag' },
    })
    expect(await viewInboxItemAs(session, project)).toBeNull()
  })

  it('answers null for a platform item unless the recipient holds the platform permission', async () => {
    const feedback = row({
      organizationId: 'org_platform',
      type: 'feedback.submitted',
      resourceType: 'product_feedback',
      resourceId: 'f1',
    })
    const platformSession = makeSession({ organizationId: 'org_platform' })
    expect(await viewInboxItemAs(platformSession, feedback)).toBeNull()
    vi.mocked(hasPlatformPermission).mockResolvedValue(true)
    expect((await viewInboxItemAs(platformSession, feedback))?.href).toBe('/app/platform/feedback?report=f1')
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

  it('sends Piloti’s Rückfrage to the Prüfansicht while events do not wake Piloti, and keeps it in the row when they do', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([onMark({ id: 'asks', type: 'piloti.asks_you' })])

    expect((await listInbox(session)).items[0]!.answerIn).toBe('review')

    const wakes = makeSession({ featureFlags: ['collaboration', 'piloti-wakes'] })
    expect((await listInbox(wakes)).items[0]!.answerIn).toBe('row')
  })

  it('lets an answer from the row address Piloti only where events wake it, and only where the row answers', async () => {
    vi.mocked(repository.listInboxItems).mockResolvedValue([
      onMark({ id: 'writer' }),
      onMark({ id: 'reader', resourceId: 'doc_r', groupKey: 'g_r' }),
    ])

    const off = await listInbox(session)
    expect(off.items.map((item) => [item.id, item.pilotiWakes])).toEqual([
      ['writer', false],
      ['reader', false],
    ])

    const on = await listInbox(makeSession({ featureFlags: ['collaboration', 'piloti-wakes'] }))
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
