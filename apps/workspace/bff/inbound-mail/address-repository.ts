import { INBOUND_MAIL_ADDRESS_STATS_DAYS } from './inbound-mail-vocabulary'
import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import type { DbExecutor } from '@/lib/db/executor'
import { inboundMailAddresses, inboundMails, type InboundMailAddressRow } from '@/lib/db/schema/inbound-mail'
import { mailThreadFollows } from '@/lib/db/schema/mail-thread'
import type { MailThreadFollowEndReason } from '@/lib/mail-thread/mail-thread-vocabulary'

export async function findActiveAddress(projectId: string): Promise<InboundMailAddressRow | null> {
  const [row] = await getDb()
    .select()
    .from(inboundMailAddresses)
    .where(and(eq(inboundMailAddresses.projectId, projectId), isNull(inboundMailAddresses.revokedAt)))
    .limit(1)
  return row ?? null
}

export interface NewAddress {
  organizationId: string
  projectId: string
  token: string
  slug: string
  createdBy: string
}

export type AddressConflict = 'token' | 'active'

export type AddressWrite<T> = { ok: true; value: T } | { ok: false; conflict: AddressConflict }

function addressConflictOf(error: unknown): AddressConflict | null {
  if (isUniqueViolation(error, 'uniq_inbound_mail_addresses_token')) return 'token'
  if (isUniqueViolation(error, 'uniq_inbound_mail_addresses_active_project')) return 'active'
  return null
}

export async function insertAddress(input: NewAddress): Promise<AddressWrite<InboundMailAddressRow>> {
  try {
    const [row] = await getDb().insert(inboundMailAddresses).values(input).returning()
    if (!row) throw new Error('inserting an inbound mail address returned no row')
    return { ok: true, value: row }
  } catch (error) {
    const conflict = addressConflictOf(error)
    if (conflict) return { ok: false, conflict }
    throw error
  }
}

export interface EndedFollow {
  id: string
  threadId: string
  userId: string
}

export type ProjectFollowEnd = Extract<MailThreadFollowEndReason, 'address_rotated' | 'project_closed'>

export async function endProjectFollows(
  executor: DbExecutor,
  projectId: string,
  end: { endedBy: string; reason: ProjectFollowEnd },
  at: Date,
): Promise<EndedFollow[]> {
  return executor
    .update(mailThreadFollows)
    .set({ endedAt: at, endedBy: end.endedBy, endedReason: end.reason })
    .where(and(eq(mailThreadFollows.projectId, projectId), isNull(mailThreadFollows.endedAt)))
    .returning({ id: mailThreadFollows.id, threadId: mailThreadFollows.threadId, userId: mailThreadFollows.userId })
}

export interface AddressChange {
  previousAddressId: string | null
  followsEnded: EndedFollow[]
}

export async function replaceAddress(
  next: NewAddress,
): Promise<AddressWrite<{ row: InboundMailAddressRow } & AddressChange>> {
  try {
    const value = await getDb().transaction(async (tx) => {
      const now = new Date()
      const revoked = await tx
        .update(inboundMailAddresses)
        .set({ revokedAt: now, revokedBy: next.createdBy, revokedReason: 'rotated' })
        .where(and(eq(inboundMailAddresses.projectId, next.projectId), isNull(inboundMailAddresses.revokedAt)))
        .returning({ id: inboundMailAddresses.id, forwardedFrom: inboundMailAddresses.forwardedFrom })
      const [row] = await tx
        .insert(inboundMailAddresses)
        .values({ ...next, forwardedFrom: revoked[0]?.forwardedFrom ?? [] })
        .returning()
      if (!row) throw new Error('inserting an inbound mail address returned no row')
      const followsEnded = await endProjectFollows(tx, next.projectId, { endedBy: next.createdBy, reason: 'address_rotated' }, now)
      return { row, previousAddressId: revoked[0]?.id ?? null, followsEnded }
    })
    return { ok: true, value }
  } catch (error) {
    const conflict = addressConflictOf(error)
    if (conflict) return { ok: false, conflict }
    throw error
  }
}

export async function setForwardedFrom(projectId: string, forwardedFrom: readonly string[]): Promise<InboundMailAddressRow | null> {
  const [row] = await getDb()
    .update(inboundMailAddresses)
    .set({ forwardedFrom: [...forwardedFrom] })
    .where(and(eq(inboundMailAddresses.projectId, projectId), isNull(inboundMailAddresses.revokedAt)))
    .returning()
  return row ?? null
}

export async function findForwardedFrom(addressId: string): Promise<string[]> {
  const [row] = await getDb()
    .select({ forwardedFrom: inboundMailAddresses.forwardedFrom })
    .from(inboundMailAddresses)
    .where(eq(inboundMailAddresses.id, addressId))
    .limit(1)
  return row?.forwardedFrom ?? []
}

export async function switchOffAddress(projectId: string, revokedBy: string): Promise<AddressChange | null> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const [revoked] = await tx
      .update(inboundMailAddresses)
      .set({ revokedAt: now, revokedBy, revokedReason: 'switched_off' })
      .where(and(eq(inboundMailAddresses.projectId, projectId), isNull(inboundMailAddresses.revokedAt)))
      .returning({ id: inboundMailAddresses.id })
    if (!revoked) return null
    return { previousAddressId: revoked.id, followsEnded: await endProjectFollows(tx, projectId, { endedBy: revokedBy, reason: 'address_rotated' }, now) }
  })
}

export async function addressActivity(projectId: string): Promise<{ lastReceivedAt: Date | null; received: number; droppedLast30Days: number }> {
  const [row] = await getDb()
    .select({
      lastReceivedAt: sql<string | null>`max(${inboundMails.receivedAt})`,
      received: sql<string>`count(*) filter (where ${inboundMails.status} <> 'dropped')`,
      dropped: sql<string>`count(*) filter (where ${inboundMails.status} = 'dropped' and ${inboundMails.receivedAt} > now() - make_interval(days => ${INBOUND_MAIL_ADDRESS_STATS_DAYS}))`,
    })
    .from(inboundMails)
    .where(and(eq(inboundMails.projectId, projectId), sql`${inboundMails.status} <> 'receiving'`))
  return {
    lastReceivedAt: row?.lastReceivedAt ? new Date(row.lastReceivedAt) : null,
    received: Number(row?.received ?? 0),
    droppedLast30Days: Number(row?.dropped ?? 0),
  }
}

export async function ownDomainVerifiedShare(organizationId: string): Promise<number | null> {
  const [row] = await getDb()
    .select({
      members: sql<string>`count(*)`,
      verified: sql<string>`count(*) filter (where ${inboundMails.senderTrust} = 'member_verified')`,
    })
    .from(inboundMails)
    .where(
      and(
        eq(inboundMails.organizationId, organizationId),
        inArray(inboundMails.senderTrust, ['member_verified', 'member_unverified']),
        sql`${inboundMails.receivedAt} > now() - make_interval(days => ${INBOUND_MAIL_ADDRESS_STATS_DAYS})`,
      ),
    )
  const members = Number(row?.members ?? 0)
  return members === 0 ? null : Number(row?.verified ?? 0) / members
}
