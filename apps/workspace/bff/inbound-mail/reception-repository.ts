import 'server-only'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import type { DbExecutor } from '@/lib/db/executor'
import { inboundMailAddresses, inboundMails, type NewInboundMailRow } from '@/lib/db/schema/inbound-mail'
import { projects } from '@/lib/db/schema/projects'
import { enqueueJobIfAbsent } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'

export interface ResolvedInboundAddress {
  addressId: string
  organizationId: string
  projectId: string
}

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

const STAGED_STATUSES = ['receiving', 'received', 'waiting'] as const

export interface StagedBytes {
  address: number
  organization: number
}

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

export async function insertReception(reception: NewReception): Promise<void> {
  await getDb()
    .insert(inboundMails)
    .values({ ...reception, status: 'receiving' })
}

export async function findMailIdByDeliveryKey(addressId: string, deliveryKey: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: inboundMails.id })
    .from(inboundMails)
    .where(and(eq(inboundMails.addressId, addressId), eq(inboundMails.deliveryKey, deliveryKey)))
    .limit(1)
  return row?.id ?? null
}

export type ReceptionOutcome = 'received' | 'duplicate'

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

export async function queueReceiveJob(
  mail: { mailId: string; organizationId: string; projectId: string },
  executor: DbExecutor = getDb(),
): Promise<boolean> {
  return enqueueJobIfAbsent(
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

export async function forgetReceptionObject(mailId: string): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ rawStorageKey: null, updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'receiving')))
}
