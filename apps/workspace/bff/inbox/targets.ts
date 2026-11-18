import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { INBOX_TARGET_TYPES, type InboxItemType, type InboxTargetType } from '@/lib/db/schema/inbox'
import { SHAREABLE_RESOURCE_TYPES, type ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { hasPlatformPermission } from '@/lib/authz/platform'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveResourceAccess } from '@/lib/sharing/access'
import { describeResource } from '@/lib/sharing/registry'
import {
  MARK_ANCHORED_INBOX_TYPES,
  PLATFORM_INBOX_PERMISSION,
  PROPOSAL_ANCHORED_INBOX_TYPES,
} from './registry'
import { findOwnUploadBatch } from '@/lib/upload-batches/service'
import { getOwnProductFeedback } from '@/lib/product-feedback/repository'
import { feedbackThreadHref } from '@/lib/product-feedback/types'
import { inboundMailPaths, inboundMailReadyPath } from '@/lib/inbound-mail/paths'

export interface InboxTargetLinkContext {
  itemType: InboxItemType
  anchorId?: string | null
  taskId?: string | null
  run?: RunMessageRef | null
}

export interface RunMessageRef {
  conversationId: string
  runId: string
  messageId: string
}

export interface InboxTargetAccess {
  projectId: string | null
  deepLink: (context: InboxTargetLinkContext) => string
}

export interface InboxTargetDescriptor {
  readonly type: InboxTargetType
  readonly resolve: (
    session: AuthorizedSession,
    resourceId: string,
  ) => Promise<InboxTargetAccess | null>
}

const ORGANIZATION_DESTINATIONS: Partial<Record<InboxItemType, string>> = {
  'storage.quota_warning': '/app/organization/storage',
  'document.quarantined': '/app/organization/quarantine',
  'document.release_requested': '/app/organization/quarantine',
  'agent.proposal_waiting': '/app/office-shelf',
}

function rootSortHref(shelfPath: string, runId: string | null | undefined): string {
  const run = runId?.trim()
  return run ? `${shelfPath}?rootSort=${encodeURIComponent(run)}` : shelfPath
}

function shareableTarget(type: ShareableResourceType): InboxTargetDescriptor {
  return {
    type,
    resolve: async (session, resourceId) => {
      const access = await resolveResourceAccess(session, type, resourceId)
      if (!access.role) return null
      if (access.contentLocked) return null
      return {
        projectId: access.container.projectId,
        deepLink: (context) => {
          const anchor = context.anchorId ?? undefined
          const onMark = MARK_ANCHORED_INBOX_TYPES.includes(context.itemType)
          const onProposal = PROPOSAL_ANCHORED_INBOX_TYPES.includes(context.itemType)
          return describeResource(type).deepLink(resourceId, {
            anchorId: onMark || onProposal ? undefined : anchor,
            markId: onMark ? anchor : undefined,
            projectId: access.container.projectId,
          })
        },
      }
    },
  }
}

const organizationTarget: InboxTargetDescriptor = {
  type: 'organization',
  resolve: async (session, resourceId) => {
    if (resourceId !== session.organizationId) return null
    return {
      projectId: null,
      deepLink: (context) =>
        context.itemType.startsWith('root_sort.')
          ? rootSortHref('/app/office-shelf', context.anchorId)
          : (ORGANIZATION_DESTINATIONS[context.itemType] ?? '/app/organization'),
    }
  },
}

const shareableTargets = Object.fromEntries(
  SHAREABLE_RESOURCE_TYPES.map((type) => [type, shareableTarget(type)]),
) as Record<ShareableResourceType, InboxTargetDescriptor>

const projectTarget: InboxTargetDescriptor = {
  type: 'project',
  resolve: async (session, resourceId) => {
    try {
      await requireProjectAccess(session, resourceId, 'project:view')
    } catch {
      return null
    }
    return {
      projectId: resourceId,
      deepLink: (context) => {
        if (context.itemType === 'mail_import.completed' || context.itemType === 'mail_import.failed') {
          const anchor = context.anchorId?.trim()
          const folder = anchor && !anchor.startsWith('import:') ? anchor : null
          return `/app/projects/${resourceId}/files${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`
        }
        if (context.itemType === 'agent.proposal_waiting') return `/app/projects/${resourceId}/files`
        if (context.itemType === 'agent.intake_ready') return `/app/projects/${resourceId}/setup`
        const mailLink = inboundMailLink(resourceId, context)
        if (mailLink) return mailLink
        if (context.itemType.startsWith('root_sort.')) {
          return rootSortHref(`/app/projects/${resourceId}/files`, context.anchorId)
        }
        if (context.run) return runDeepLink(resourceId, context.run)
        const taskId = context.taskId?.trim() ? context.taskId.trim() : null
        if (taskId) {
          return `/app/projects/${resourceId}/automation?tab=tasks&task=${encodeURIComponent(taskId)}`
        }
        return `/app/projects/${resourceId}/automation?tab=jobs`
      },
    }
  },
}

function inboundMailLink(projectId: string, context: InboxTargetLinkContext): string | null {
  const paths = inboundMailPaths(projectId)
  const waiting = { status: 'waiting', outcome: null } as const
  switch (context.itemType) {
    case 'inbound_mail.waiting':
      return inboundMailReadyPath(projectId)
    case 'inbound_mail.expiring':
    case 'inbound_mail.cap_reached':
      return paths.list(waiting)
    case 'inbound_mail.filing_failed':
    case 'inbound_mail.held': {
      const mailId = context.anchorId?.trim()
      return mailId ? paths.mail(mailId, waiting) : paths.list(waiting)
    }
    case 'inbound_mail.held_for_writers':
    case 'inbound_mail.rejected':
    case 'inbound_mail.expired':
      return paths.files
    case 'inbound_mail.decided': {
      const folderId = context.anchorId?.trim()
      return folderId ? `${paths.files}?folder=${encodeURIComponent(folderId)}` : paths.files
    }
    default:
      return null
  }
}

function runDeepLink(projectId: string, run: RunMessageRef): string {
  const session = encodeURIComponent(run.conversationId)
  const runId = encodeURIComponent(run.runId)
  const message = encodeURIComponent(run.messageId)
  return `/app/projects/${projectId}/chat?session=${session}&run=${runId}#message-${message}`
}

const productFeedbackTarget: InboxTargetDescriptor = {
  type: 'product_feedback',
  resolve: async (session, resourceId) => {
    const [platform, own] = await Promise.all([
      hasPlatformPermission(session, PLATFORM_INBOX_PERMISSION),
      getOwnProductFeedback(session.organizationId, session.userId, resourceId).catch(() => null),
    ])
    if (!platform && !own) return null
    return {
      projectId: null,
      deepLink: ({ itemType }) =>
        own && (itemType === 'feedback.replied' || !platform)
          ? feedbackThreadHref(resourceId)
          : `/app/platform/feedback?report=${encodeURIComponent(resourceId)}`,
    }
  },
}

const uploadBatchTarget: InboxTargetDescriptor = {
  type: 'upload_batch',
  resolve: async (session, resourceId) => {
    const batch = await findOwnUploadBatch(session, resourceId).catch(() => null)
    if (!batch) return null
    return { projectId: null, deepLink: () => `/app/uploads/${encodeURIComponent(resourceId)}` }
  },
}

export const INBOX_TARGET_REGISTRY: Record<InboxTargetType, InboxTargetDescriptor> = {
  ...shareableTargets,
  organization: organizationTarget,
  project: projectTarget,
  product_feedback: productFeedbackTarget,
  upload_batch: uploadBatchTarget,
}

export function findInboxTarget(type: string): InboxTargetDescriptor | null {
  return (INBOX_TARGET_TYPES as readonly string[]).includes(type)
    ? INBOX_TARGET_REGISTRY[type as InboxTargetType]
    : null
}
