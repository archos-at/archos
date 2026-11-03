/**
 * SQL for a project's inbound address (ADR-0137): the active one, a new one, a
 * rotation or switch-off and the follows it ends, and what it has received.
 *
 * No authorization here: the service decides who may ask, and row-level
 * security is the backstop. Every list is bounded. The rules a row must keep
 * are CHECKs in the migration (`./repository.ts`).
 */

import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import type { DbExecutor } from '@/lib/db/executor'
import { inboundMailAddresses, inboundMails, type InboundMailAddressRow } from '@/lib/db/schema/inbound-mail'
import { mailThreadFollows } from '@/lib/db/schema/mail-thread'
import type { MailThreadFollowEndReason } from '@/lib/mail-thread/mail-thread-vocabulary'

/** A project's active address, or null. */
export async function findActiveAddress(projectId: string): Promise<InboundMailAddressRow | null> {
  const [row] = await getDb()
    .select()
    .from(inboundMailAddresses)
    .where(and(eq(inboundMailAddresses.projectId, projectId), isNull(inboundMailAddresses.revokedAt)))
    .limit(1)
  return row ?? null
}

/** A new address, as the service mints it. */
export interface NewAddress {
  organizationId: string
  projectId: string
  token: string
  slug: string
  createdBy: string
}

/** Why an address could not be written: its token was taken (mint again), or the project has an active one already. */
export type AddressConflict = 'token' | 'active'

export type AddressWrite<T> = { ok: true; value: T } | { ok: false; conflict: AddressConflict }

function addressConflictOf(error: unknown): AddressConflict | null {
  if (isUniqueViolation(error, 'uniq_inbound_mail_addresses_token')) return 'token'
  if (isUniqueViolation(error, 'uniq_inbound_mail_addresses_active_project')) return 'active'
  return null
}

/** Give a project its first (or next, after a switch-off) address. The partial unique index decides a race. */
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

/** A follow ended for the whole project at once: by an address change (D31) or the project's close. */
export interface EndedFollow {
  id: string
  threadId: string
  userId: string
}

/** Why every follow of a project ends at once. */
export type ProjectFollowEnd = Extract<MailThreadFollowEndReason, 'address_rotated' | 'project_closed'>

/**
 * End every running follow of a project, as the person `endedBy` who replaced
 * or switched off its address, or closed it. One statement: the caller's
 * transaction, or the database's own.
 */
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

/** What replacing or switching off an address did. */
export interface AddressChange {
  previousAddressId: string | null
  followsEnded: EndedFollow[]
}

/**
 * Replace the project's address with `next` in one transaction: the old one is
 * revoked (`rotated`, it stops resolving at once), the new one inserted, and
 * every follow on the project ended (`address_rotated`): whoever learned the
 * old address could otherwise keep writing into a followed thread.
 */
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
        .returning({ id: inboundMailAddresses.id })
      const [row] = await tx.insert(inboundMailAddresses).values(next).returning()
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

/**
 * Switch the project's address off (`switched_off`): it stops resolving, the
 * row stays as history (DELETE is not the app's), and the project's follows
 * end with it. Null when the project had no active address.
 */
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

/** What the address dialog says about the project's mail: when it last arrived, and what was dropped unseen. */
export async function addressActivity(projectId: string): Promise<{ lastReceivedAt: Date | null; droppedLast30Days: number }> {
  const [row] = await getDb()
    .select({
      lastReceivedAt: sql<string | null>`max(${inboundMails.receivedAt})`,
      dropped: sql<string>`count(*) filter (where ${inboundMails.status} = 'dropped' and ${inboundMails.receivedAt} > now() - interval '30 days')`,
    })
    .from(inboundMails)
    .where(and(eq(inboundMails.projectId, projectId), sql`${inboundMails.status} <> 'receiving'`))
  return {
    lastReceivedAt: row?.lastReceivedAt ? new Date(row.lastReceivedAt) : null,
    droppedLast30Days: Number(row?.dropped ?? 0),
  }
}

/**
 * Of the mail the office's own members sent to any of its projects in the last
 * 30 days, the share their domain signed; null when there was none (RT-X6).
 * The trust survives the scrub of a settled mail, so settled mail counts too.
 */
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
        sql`${inboundMails.receivedAt} > now() - interval '30 days'`,
      ),
    )
  const members = Number(row?.members ?? 0)
  return members === 0 ? null : Number(row?.verified ?? 0) / members
}
