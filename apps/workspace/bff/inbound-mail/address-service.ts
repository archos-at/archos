import 'server-only'

import { captureServer } from '@/lib/analytics/posthog-server'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboundMailAddressRow } from '@/lib/db/schema/inbound-mail'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { findProjectInOrg } from '@/lib/projects/repository'
import { managesProject, requireAddressManager, requireMailReviewer } from './access'
import { formatInboundAddress, inboundMailDomain, mintToken, projectSlug } from './address'
import { settleFollowExpiring } from './announce'
import { auditFollowsEnded } from './audit'
import { refusal } from './decision'
import type { InboundMailAddressView } from './inbound-mail-wire'
import {
  addressActivity,
  findActiveAddress,
  insertAddress,
  ownDomainVerifiedShare,
  replaceAddress,
  switchOffAddress,
  type AddressChange,
  type NewAddress,
} from './repository'

const MINT_ATTEMPTS = 3

function requireDomain(): string {
  const domain = inboundMailDomain()
  if (!domain) throw refusal('mail_not_received_here', 'This deployment receives no mail, so a project cannot have an address')
  return domain
}

async function addressView(session: AuthorizedSession, projectId: string): Promise<InboundMailAddressView> {
  const domain = inboundMailDomain()
  const [active, activity, share, canManage] = await Promise.all([
    findActiveAddress(projectId),
    addressActivity(projectId),
    ownDomainVerifiedShare(session.organizationId),
    managesProject(session, projectId),
  ])
  return {
    state: !domain ? 'unavailable' : active ? 'active' : 'none',
    address: domain && active ? formatInboundAddress(active.slug, active.token, domain) : null,
    canManage,
    lastReceivedAt: activity.lastReceivedAt?.toISOString() ?? null,
    droppedLast30Days: activity.droppedLast30Days,
    ownDomainVerifiedShare: share,
  }
}

export async function getInboundMailAddress(session: AuthorizedSession, projectId: string): Promise<InboundMailAddressView> {
  await requireMailReviewer(session, projectId)
  return addressView(session, projectId)
}

async function newAddress(session: AuthorizedSession, projectId: string): Promise<NewAddress> {
  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError()
  return {
    organizationId: session.organizationId,
    projectId,
    token: mintToken(),
    slug: projectSlug(project.name),
    createdBy: session.userId,
  }
}

function auditAddress(
  session: AuthorizedSession,
  action: 'inbound_mail_address.created' | 'inbound_mail_address.rotated' | 'inbound_mail_address.deleted',
  addressId: string,
  projectId: string,
  extra: { previousAddressId?: string; followsEnded?: number } = {},
): void {
  recordAuditEventAfterCommit({
    action,
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'inbound_mail_address',
    targetId: addressId,
    alsoTargets: [{ type: 'project', id: projectId }],
    metadata: { projectId, ...extra },
  })
}

export async function createInboundMailAddress(session: AuthorizedSession, projectId: string): Promise<InboundMailAddressView> {
  await requireAddressManager(session, projectId)
  requireDomain()
  if (await findActiveAddress(projectId)) return addressView(session, projectId)
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
    const written = await insertAddress(await newAddress(session, projectId))
    if (written.ok) {
      auditAddress(session, 'inbound_mail_address.created', written.value.id, projectId)
      captureServer({ event: 'inbound_mail_address_created', distinctId: session.userId, organizationId: session.organizationId, properties: {} })
      publishProjectChanged(session.organizationId, projectId)
      return addressView(session, projectId)
    }
    if (written.conflict === 'active') return addressView(session, projectId)
  }
  throw new ConflictError('Could not mint a project mail address. Try again.')
}

async function afterAddressChange(session: AuthorizedSession, projectId: string, change: AddressChange): Promise<void> {
  auditFollowsEnded(session.organizationId, projectId, session.userId, change.followsEnded)
  await settleFollowExpiring(session.organizationId, change.followsEnded.map((follow) => follow.id))
  publishProjectChanged(session.organizationId, projectId)
}

export async function rotateInboundMailAddress(session: AuthorizedSession, projectId: string): Promise<InboundMailAddressView> {
  await requireAddressManager(session, projectId)
  requireDomain()
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
    const written = await replaceAddress(await newAddress(session, projectId))
    if (!written.ok) {
      if (written.conflict === 'token') continue
      throw new ConflictError('The address was replaced at the same time. Read it again.')
    }
    const { row, ...change }: { row: InboundMailAddressRow } & AddressChange = written.value
    auditAddress(session, 'inbound_mail_address.rotated', row.id, projectId, {
      ...(change.previousAddressId ? { previousAddressId: change.previousAddressId } : {}),
      followsEnded: change.followsEnded.length,
    })
    captureServer({ event: 'inbound_mail_address_rotated', distinctId: session.userId, organizationId: session.organizationId, properties: {} })
    await afterAddressChange(session, projectId, change)
    return addressView(session, projectId)
  }
  throw new ConflictError('Could not mint a project mail address. Try again.')
}

export async function deleteInboundMailAddress(session: AuthorizedSession, projectId: string): Promise<InboundMailAddressView> {
  await requireAddressManager(session, projectId)
  const change = await switchOffAddress(projectId, session.userId)
  if (change?.previousAddressId) {
    auditAddress(session, 'inbound_mail_address.deleted', change.previousAddressId, projectId)
    await afterAddressChange(session, projectId, change)
  }
  return addressView(session, projectId)
}
