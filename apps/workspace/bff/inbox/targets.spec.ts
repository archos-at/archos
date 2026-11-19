/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sharing/access', () => ({ resolveResourceAccess: vi.fn() }))
vi.mock('@/lib/sharing/registry', () => ({ describeResource: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/authz/platform', () => ({ hasPlatformPermission: vi.fn(async () => false) }))
vi.mock('@/lib/product-feedback/repository', () => ({ getOwnProductFeedback: vi.fn(async () => null) }))

import type { AuthorizedSession } from '@/lib/auth/types'
import { hasPlatformPermission } from '@/lib/authz/platform'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'
import { getOwnProductFeedback } from '@/lib/product-feedback/repository'
import { resolveResourceAccess } from '@/lib/sharing/access'
import { describeResource } from '@/lib/sharing/registry'
import { INBOX_TARGET_REGISTRY, findInboxTarget, type InboxTargetLinkContext } from './targets'

function makeSession(organizationId = 'org_1'): AuthorizedSession {
  return {
    userId: 'user_1',
    email: 'user_1@example.test',
    name: 'Test User',
    accessToken: 'workos_token',
    organizationId,
    organizationMembershipId: 'om_1',
    role: 'admin',
    permissions: [],
    featureFlags: null,
  }
}

describe('findInboxTarget', () => {
  it('resolves the registered target types', () => {
    expect(findInboxTarget('conversation')).toBe(INBOX_TARGET_REGISTRY.conversation)
    expect(findInboxTarget('organization')).toBe(INBOX_TARGET_REGISTRY.organization)
  })

  it('returns null — never throws — for a type this build has never heard of', () => {
    expect(findInboxTarget('spaceship')).toBeNull()
    expect(findInboxTarget('')).toBeNull()
  })
})

describe('the organization target', () => {
  const organizationTarget = INBOX_TARGET_REGISTRY.organization

  it('deep-links a storage alert to the page that explains it', async () => {
    const access = await organizationTarget.resolve(makeSession(), 'org_1')

    expect(access).not.toBeNull()
    expect(access!.deepLink({ itemType: 'storage.quota_warning' })).toBe(
      '/app/organization/storage',
    )
  })

  it('deep-links a Büroablage filing suggestion to the Büroablage, where its file row carries it', async () => {
    const access = await organizationTarget.resolve(makeSession(), 'org_1')

    expect(access!.deepLink({ itemType: 'agent.proposal_waiting', anchorId: 'prop-1' })).toBe('/app/office-shelf')
  })

  it('lands an office filing sort on the office shelf with the run open', async () => {
    const access = await organizationTarget.resolve(makeSession(), 'org_1')

    expect(access!.deepLink({ itemType: 'root_sort.ready', anchorId: 'run-1' })).toBe(
      '/app/office-shelf?rootSort=run-1',
    )
    expect(access!.deepLink({ itemType: 'root_sort.failed', anchorId: null })).toBe('/app/office-shelf')
  })

  it('opens the folder the norms were found in on the office shelf', async () => {
    const access = await organizationTarget.resolve(makeSession(), 'org_1')

    expect(access!.deepLink({ itemType: 'office_shelf.norms_found', anchorId: 'folder 1' })).toBe(
      '/app/office-shelf?folder=folder%201',
    )
    expect(access!.deepLink({ itemType: 'office_shelf.norms_found', anchorId: null })).toBe('/app/office-shelf')
  })

  it('falls back to the organization overview for a type with no destination', async () => {
    const access = await organizationTarget.resolve(makeSession(), 'org_1')

    expect(access!.deepLink({ itemType: 'conversation.activity' })).toBe('/app/organization')
  })

  it('redacts a row addressed to a DIFFERENT organization', async () => {
    expect(await organizationTarget.resolve(makeSession('org_1'), 'org_other')).toBeNull()
  })

  it('does not consult the sharing registry at all', async () => {
    await organizationTarget.resolve(makeSession(), 'org_1')

    expect(resolveResourceAccess).not.toHaveBeenCalled()
    expect(describeResource).not.toHaveBeenCalled()
  })
})

describe('the conversation target', () => {
  const conversationTarget = INBOX_TARGET_REGISTRY.conversation

  it('delegates to the sharing registry, so shareable access stays defined once', async () => {
    vi.mocked(resolveResourceAccess).mockResolvedValue({
      role: 'collaborator',
      reason: 'visibility-project',
      visibility: 'project',
      container: { organizationId: 'org_1', projectId: 'proj_1' },
      canEscalate: false,
      contentLocked: false,
    })
    vi.mocked(describeResource).mockReturnValue({
      deepLink: (resourceId: string, options?: { anchorId?: string; projectId?: string | null }) =>
        `/app/projects/${options?.projectId}/chat?session=${resourceId}` +
        (options?.anchorId ? `#message-${options.anchorId}` : ''),
    } as never)

    const access = await conversationTarget.resolve(makeSession(), 'conv_1')

    expect(access!.deepLink({ itemType: 'conversation.activity', anchorId: 'msg_9' })).toBe(
      '/app/projects/proj_1/chat?session=conv_1#message-msg_9',
    )
  })

  it('is unreachable when the reader has no access role', async () => {
    vi.mocked(resolveResourceAccess).mockResolvedValue({
      role: null,
      reason: null,
      visibility: 'private',
      container: { organizationId: 'org_1', projectId: 'proj_1' },
      canEscalate: false,
      contentLocked: false,
    })

    expect(await conversationTarget.resolve(makeSession(), 'conv_1')).toBeNull()
  })

  it('is unreachable — so the row renders redacted, title and all — when the reader may no longer read what the chat drew on (ADR-0088)', async () => {
    vi.mocked(resolveResourceAccess).mockResolvedValue({
      role: 'owner',
      reason: 'creator',
      visibility: 'private',
      container: { organizationId: 'org_1', projectId: 'proj_1' },
      canEscalate: false,
      contentLocked: true,
    })

    expect(await conversationTarget.resolve(makeSession(), 'conv_1')).toBeNull()
  })
})

describe('the project target', () => {
  const projectTarget = INBOX_TARGET_REGISTRY.project

  it('lands a run outcome on the project automation page when the reader may view the project', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValueOnce({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
    const access = await projectTarget.resolve(makeSession(), 'proj_1')
    expect(access).not.toBeNull()
    expect(access!.deepLink({ itemType: 'task_run.completed', anchorId: 'backend-job-1' })).toBe(
      '/app/projects/proj_1/automation?tab=jobs',
    )
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_1' }), 'proj_1', 'project:view')
  })

  it('lands on the task detail when the payload names the delegated task', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValueOnce({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
    const access = await projectTarget.resolve(makeSession(), 'proj_1')
    expect(access).not.toBeNull()
    expect(
      access!.deepLink({ itemType: 'task_run.completed', anchorId: 'backend-job-1', taskId: 'task-1' }),
    ).toBe('/app/projects/proj_1/automation?tab=tasks&task=task-1')
  })

  it('falls back to the automation page when the task id is absent or blank', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
    const access = await projectTarget.resolve(makeSession(), 'proj_1')
    expect(access).not.toBeNull()
    expect(access!.deepLink({ itemType: 'task_run.completed', anchorId: 'backend-job-1' })).toBe(
      '/app/projects/proj_1/automation?tab=jobs',
    )
    expect(
      access!.deepLink({ itemType: 'task_run.completed', anchorId: 'backend-job-1', taskId: null }),
    ).toBe('/app/projects/proj_1/automation?tab=jobs')
    expect(
      access!.deepLink({ itemType: 'task_run.completed', anchorId: 'backend-job-1', taskId: '   ' }),
    ).toBe('/app/projects/proj_1/automation?tab=jobs')
  })

  it('lands a project sort on its files with the run open', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValueOnce({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
    const access = await projectTarget.resolve(makeSession(), 'proj_1')
    expect(access!.deepLink({ itemType: 'root_sort.ready', anchorId: 'run-1' })).toBe(
      '/app/projects/proj_1/files?rootSort=run-1',
    )
    expect(access!.deepLink({ itemType: 'root_sort.failed', anchorId: 'run 2' })).toBe(
      '/app/projects/proj_1/files?rootSort=run%202',
    )
  })

  it('lands the E-Mail-Eingang’s rows where each can be acted on (ADR-0137)', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValueOnce({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
    const access = await projectTarget.resolve(makeSession(), 'proj_1')
    const list = '/app/projects/proj_1/files/mail'
    expect(access!.deepLink({ itemType: 'inbound_mail.waiting', anchorId: 'mail-9' })).toBe(`${list}#ready`)
    expect(access!.deepLink({ itemType: 'inbound_mail.expiring', anchorId: 'mail-9' })).toBe(list)
    expect(access!.deepLink({ itemType: 'inbound_mail.cap_reached', anchorId: 'address-1' })).toBe(list)
    expect(access!.deepLink({ itemType: 'inbound_mail.filing_failed', anchorId: 'mail-9' })).toBe(`${list}/mail-9`)
    expect(access!.deepLink({ itemType: 'inbound_mail.decided', anchorId: 'folder 1' })).toBe(
      '/app/projects/proj_1/files?folder=folder%201',
    )
    expect(access!.deepLink({ itemType: 'inbound_mail.decided', anchorId: null })).toBe('/app/projects/proj_1/files')
  })

  it('redacts the row, rather than throwing, for a project the reader can no longer open', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new Error('forbidden'))
    await expect(projectTarget.resolve(makeSession(), 'proj_gone')).resolves.toBeNull()
  })
})

describe('where an anchor lands (marks, proposals and Fassungen anchor rows too)', () => {
  const reachable = {
    role: 'collaborator',
    reason: 'visibility-project',
    visibility: 'project',
    container: { organizationId: 'org_1', projectId: 'proj_1' },
    canEscalate: false,
    contentLocked: false,
  } as const

  const deepLink = vi.fn((_id: string, _options?: unknown) => '/somewhere')

  async function linkFor(target: 'document' | 'conversation', context: InboxTargetLinkContext) {
    vi.mocked(resolveResourceAccess).mockResolvedValue(reachable)
    vi.mocked(describeResource).mockReturnValue({ deepLink } as never)
    const access = await INBOX_TARGET_REGISTRY[target].resolve(makeSession(), 'res_1')
    access!.deepLink(context)
    return deepLink.mock.calls.at(-1)?.[1]
  }

  it.each(['agent.asks_you', 'agent.work_done', 'agent.work_failed', 'annotation.assigned_to_you', 'annotation.activity'] as const)(
    'opens a document at the mark for %s',
    async (itemType) => {
      expect(await linkFor('document', { itemType, anchorId: 'ann-1' })).toEqual({
        anchorId: undefined,
        markId: 'ann-1',
        projectId: 'proj_1',
      })
    },
  )

  it('keeps a Fassung anchor a Fassung anchor: a review request is not a mark', async () => {
    expect(await linkFor('document', { itemType: 'document.review_requested', anchorId: 'version-1' })).toEqual({
      anchorId: 'version-1',
      markId: undefined,
      projectId: 'proj_1',
    })
  })

  it('does not read a proposal id as a message of the chat it was made in', async () => {
    expect(await linkFor('conversation', { itemType: 'agent.proposal_waiting', anchorId: 'prop-1' })).toEqual({
      anchorId: undefined,
      markId: undefined,
      projectId: 'proj_1',
    })
  })

  it('still lands a mention on its message', async () => {
    expect(await linkFor('conversation', { itemType: 'mention.requested', anchorId: 'msg-1' })).toEqual({
      anchorId: 'msg-1',
      markId: undefined,
      projectId: 'proj_1',
    })
  })

  it('is unreachable for a document the reader has no role on, so a mark row is redacted', async () => {
    vi.mocked(resolveResourceAccess).mockResolvedValue({ ...reachable, role: null, reason: null })
    expect(await INBOX_TARGET_REGISTRY.document.resolve(makeSession(), 'res_1')).toBeNull()
  })

  it('sends a proposal with no chat (a filing suggestion) to the project files, and redacts it for a reader who cannot view the project', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValueOnce({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
    const access = await INBOX_TARGET_REGISTRY.project.resolve(makeSession(), 'proj_1')
    expect(access!.deepLink({ itemType: 'agent.proposal_waiting', anchorId: 'prop-1' })).toBe('/app/projects/proj_1/files')

    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new Error('forbidden'))
    expect(await INBOX_TARGET_REGISTRY.project.resolve(makeSession(), 'proj_1')).toBeNull()
  })
})

describe('the product-feedback target', () => {
  const target = INBOX_TARGET_REGISTRY.product_feedback
  const REPORT = '7b6a2c1e-0000-4000-8000-000000000001'
  const own = { id: REPORT } as ProductFeedback

  it('opens the reporter\'s own thread in Mein Feedback for a reply row', async () => {
    vi.mocked(getOwnProductFeedback).mockResolvedValueOnce(own)
    const access = await target.resolve(makeSession('org_tenant'), REPORT)
    expect(getOwnProductFeedback).toHaveBeenCalledWith('org_tenant', 'user_1', REPORT)
    expect(access!.deepLink({ itemType: 'feedback.replied' })).toBe(`/app/projects?feedback=${REPORT}`)
  })

  it('sends a platform owner to the triage page for an announcement', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValueOnce(true)
    const access = await target.resolve(makeSession(), REPORT)
    expect(access!.deepLink({ itemType: 'feedback.submitted' })).toBe(`/app/platform/feedback?report=${REPORT}`)
  })

  it('a platform owner who filed the report reads its reply in Mein Feedback, its announcement on the triage page', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValueOnce(true)
    vi.mocked(getOwnProductFeedback).mockResolvedValueOnce(own)
    const access = await target.resolve(makeSession(), REPORT)
    expect(access!.deepLink({ itemType: 'feedback.replied' })).toBe(`/app/projects?feedback=${REPORT}`)
    expect(access!.deepLink({ itemType: 'feedback.submitted' })).toBe(`/app/platform/feedback?report=${REPORT}`)
  })

  it('is unreachable for anyone else, so the row is redacted', async () => {
    expect(await target.resolve(makeSession(), REPORT)).toBeNull()
  })

  it('treats a failed ownership read as not theirs', async () => {
    vi.mocked(getOwnProductFeedback).mockRejectedValueOnce(new Error('db down'))
    expect(await target.resolve(makeSession(), REPORT)).toBeNull()
  })
})
