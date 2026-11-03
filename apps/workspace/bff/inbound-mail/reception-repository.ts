/**
 * SQL for the webhook (ADR-0137): the token's address, the bytes an address
 * holds staged, and a reception from its first row to its receive job.
 *
 * {@link findActiveAddressByToken} is the lookup that happens BEFORE any
 * organization is known, and its caller wraps it in `withPlatformAccess`.
 * No authorization here: the service decides who may ask, and row-level
 * security is the backstop. Every list is bounded. The rules a row must keep
 * are CHECKs in the migration (`./repository.ts`).
 */

import 'server-only'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import type { DbExecutor } from '@/lib/db/executor'
import { inboundMailAddresses, inboundMails, type NewInboundMailRow } from '@/lib/db/schema/inbound-mail'
import { projects } from '@/lib/db/schema/projects'
import { insertJobIfAbsent } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'

/** What the webhook learns from a token, and nothing more. */
export interface ResolvedInboundAddress {
  addressId: string
  organizationId: string
  projectId: string
}

/**
 * The active address a token names, in whichever organization owns it.
 *
 * Cross-tenant by nature, the token being all the webhook has, so the caller
 * runs it under the platform bypass, and it returns ONLY the ids the rest of
 * the request needs to open a tenant scope. A revoked token and a token whose
 * project is deleted resolve to nothing: the same answer as a token nobody
 * ever minted. A closed project resolves: it holds its mail (RT-X13).
 */
export async function findActiveAddressByToken(token: string): Promise<ResolvedInboundAddress | null> {
  const [row] = await getDb()
    .select({
      addressId: inboundMailAddresses.id,
      organizationId: inboundMailAddresses.organizationId,
      projectId: inboundMailAddresses.projectId,
    })
    .from(inboundMailAddresses)
    .innerJoin(
      projects,
      and(eq(projects.id, inboundMailAddresses.projectId), eq(projects.organizationId, inboundMailAddresses.organizationId)),
    )
    .where(and(eq(inboundMailAddresses.token, token), isNull(inboundMailAddresses.revokedAt), isNull(projects.deletedAt)))
    .limit(1)
  return row ?? null
}

/** The statuses whose raw message is staged: arriving, read by no job yet, or waiting for a person. */
const STAGED_STATUSES = ['receiving', 'received', 'waiting'] as const

/** Raw bytes staged now, for one address and for its whole organization (D18's byte caps). */
export interface StagedBytes {
  address: number
  organization: number
}

/**
 * The raw message bytes staged for this address and for its organization: the
 * sum of `raw_size_bytes` over mail that is arriving, received or waiting. A
 * reception is counted from its insert (the size is its signed length), so a
 * burst of large mails cannot all pass the cap before any of them is written.
 * Attachment parts are copies of bytes inside the raw message and are not
 * counted twice.
 */
export async function stagedBytes(organizationId: string, addressId: string): Promise<StagedBytes> {
  const [row] = await getDb()
    .select({
      address: sql<string>`coalesce(sum(${inboundMails.rawSizeBytes}) filter (where ${inboundMails.addressId} = ${addressId}), 0)`,
      organization: sql<string>`coalesce(sum(${inboundMails.rawSizeBytes}), 0)`,
    })
    .from(inboundMails)
    .where(
      and(
        eq(inboundMails.organizationId, organizationId),
        inArray(inboundMails.status, [...STAGED_STATUSES]),
        isNotNull(inboundMails.rawStorageKey),
      ),
    )
  return { address: Number(row?.address ?? 0), organization: Number(row?.organization ?? 0) }
}

/** A delivery the webhook is about to stream to staging. */
export type NewReception = Pick<
  NewInboundMailRow,
  | 'id'
  | 'organizationId'
  | 'projectId'
  | 'addressId'
  | 'envelopeFrom'
  | 'rawSizeBytes'
  | 'stagingBucket'
  | 'rawStorageKey'
  | 'receivedAt'
  | 'expiresAt'
>

/**
 * Insert the `receiving` row before a byte is written (ADR-0043): the bucket
 * and the key are on the row first, so a reception that dies half way leaves a
 * row the sweep can erase by its exact key (sweep 1), never an object nothing
 * names.
 */
export async function insertReception(reception: NewReception): Promise<void> {
  await getDb()
    .insert(inboundMails)
    .values({ ...reception, status: 'receiving' })
}

/** The mail this address already holds under `deliveryKey`, if any, whatever became of it. */
export async function findMailIdByDeliveryKey(addressId: string, deliveryKey: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: inboundMails.id })
    .from(inboundMails)
    .where(and(eq(inboundMails.addressId, addressId), eq(inboundMails.deliveryKey, deliveryKey)))
    .limit(1)
  return row?.id ?? null
}

/** Whether the reception became a mail for the receive job, or was a second delivery of one already held. */
export type ReceptionOutcome = 'received' | 'duplicate'

/**
 * Turn a reception into a received mail AND queue the job that reads it, in
 * one transaction: a mail is never `received` without its job, and a job never
 * names a mail that is not. The job id is the mail's id, so the sweep that
 * re-queues a `received` mail without a live job (sweep 2) names the same job.
 *
 * A second delivery of a mail already held loses the race to
 * `uniq_inbound_mails_address_delivery`: that is `duplicate`, and nothing was
 * written.
 */
export async function completeReception(input: {
  mailId: string
  organizationId: string
  projectId: string
  deliveryKey: string
  rawSizeBytes: number
}): Promise<ReceptionOutcome> {
  try {
    return await getDb().transaction(async (tx) => {
      const updated = await tx
        .update(inboundMails)
        .set({ status: 'received', deliveryKey: input.deliveryKey, rawSizeBytes: input.rawSizeBytes, updatedAt: new Date() })
        .where(and(eq(inboundMails.id, input.mailId), eq(inboundMails.status, 'receiving')))
        .returning({ id: inboundMails.id })
      if (updated.length === 0) throw new Error(`inbound mail ${input.mailId} is not receiving`)
      await queueReceiveJob(input, tx)
      return 'received' as const
    })
  } catch (error) {
    if (isUniqueViolation(error, 'uniq_inbound_mails_address_delivery')) return 'duplicate'
    throw error
  }
}

/** Queue (or find queued) the receive job of a received mail. */
export async function queueReceiveJob(
  mail: { mailId: string; organizationId: string; projectId: string },
  executor: DbExecutor = getDb(),
): Promise<boolean> {
  return insertJobIfAbsent(
    {
      kind: 'inbound_mail_receive',
      organizationId: mail.organizationId,
      priority: BFF_JOB_PRIORITY.bulk,
      jobId: mail.mailId,
      payload: { mailId: mail.mailId, projectId: mail.projectId },
    },
    executor,
  )
}

/**
 * A reception that turned out to be a second delivery, or failed half way:
 * its object was erased (or never written), so the row stops naming it. The
 * row stays `receiving`; DELETE is not the app's (migration 0194), and sweep 1
 * deletes it once it is fifteen minutes old.
 */
export async function forgetReceptionObject(mailId: string): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ rawStorageKey: null, updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'receiving')))
}
