import 'server-only'

import { randomUUID } from 'node:crypto'
import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEvent, SYSTEM_ACTORS } from '@/lib/audit/service'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { endFollowBySystem } from '@/lib/mail-thread/follows'
import { finishOriginalMove } from '@/lib/mail-thread/originals'
import { findEntryOfMail, forgetMovedRaw } from '@/lib/mail-thread/write-repository'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import {
  announceCapReached,
  announceExpired,
  announceExpiring,
  announceFilingFailed,
  announceFollowExpiring,
  settleCapReached,
  settleHeld,
  settleProjectNotices,
} from './announce'
import { auditDecisions } from './audit'
import { decideEndedAttachments } from './entry-attachments'
import type { InboundMailCapNotice } from './inbound-mail-vocabulary'
import { scanForStorage } from './malware-scan'
import { INBOUND_MAIL_ADDRESS_STAGED_BYTES, INBOUND_MAIL_ORGANIZATION_STAGED_BYTES } from './receive'
import { rereadHeldText } from './receive-reread'
import { queueSenderFiling } from './receive-sender'
import { queueReceiveJob } from './repository'
import { eraseStagedObjects, readStagedObject } from './staging'
import * as sweeps from './sweep-repository'

export const SWEEP_BATCH = 50

export const STALE_RECEPTION_MS = 15 * 60 * 1000
export const ORPHANED_RECEPTION_MS = 5 * 60 * 1000
export const STALLED_MOVE_MS = 15 * 60 * 1000
export const AUDIT_GRACE_MS = 60 * 1000

export interface SweepCounts {
  checked: number
  errors: number
  [outcome: string]: number
}

export interface InboundMailSweepResult {
  staleReceptions: SweepCounts
  orphanedReceptions: SweepCounts
  lapsedClaims: SweepCounts
  stalledMoves: SweepCounts
  audits: SweepCounts
  expired: SweepCounts
  expiring: SweepCounts
  endedParts: SweepCounts
  rescans: SweepCounts
  rereads: SweepCounts
  releasedErasures: SweepCounts
  keptMails: SweepCounts
  follows: SweepCounts
  threads: SweepCounts
  caps: SweepCounts
}

const counts = (...outcomes: string[]): SweepCounts =>
  Object.fromEntries([['checked', 0], ['errors', 0], ...outcomes.map((outcome) => [outcome, 0])]) as SweepCounts

const discover = <T>(what: string, find: () => Promise<T[]>): Promise<T[]> =>
  withPlatformAccess(`inbound mail sweep: finding ${what} across organizations`, find)

async function eachRow<T extends { organizationId: string }>(
  rows: readonly T[],
  result: SweepCounts,
  label: (row: T) => string,
  step: (row: T) => Promise<void>,
): Promise<void> {
  result.checked += rows.length
  for (const row of rows) {
    try {
      await withTenant({ organizationId: row.organizationId }, () => step(row))
    } catch (error) {
      result.errors += 1
      console.error(`[inbound-mail] sweep could not finish ${label(row)}`, error)
    }
  }
}

export async function sweepStaleReceptions(now: Date): Promise<SweepCounts> {
  const result = counts('deleted')
  const before = new Date(now.getTime() - STALE_RECEPTION_MS)
  const rows = await discover('stale receptions', () => sweeps.findStaleReceptions(before, SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the stale reception ${row.id}`, async (row) => {
    if (row.rawStorageKey) {
      const taken = { id: row.id, rawStorageKey: row.rawStorageKey }
      if (!(await sweeps.takeStaleReceptionKey(taken, before))) return
      if ((await eraseStagedObjects(row.stagingBucket, [row.rawStorageKey]).catch(() => [row.rawStorageKey])).length > 0) {
        await sweeps.returnStaleReceptionKey(taken)
        throw new Error('its staged raw message could not be erased')
      }
    }
    const deleted = await withPlatformAccess('inbound mail sweep 1: a stale reception', () => sweeps.deleteStaleReception(row.id, before))
    if (deleted) result.deleted += 1
  })
  return result
}

export async function sweepOrphanedReceptions(now: Date): Promise<SweepCounts> {
  const result = counts('requeued')
  const before = new Date(now.getTime() - ORPHANED_RECEPTION_MS)
  const rows = await discover('received mail without a job', () => sweeps.findReceivedWithoutJob(before, SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the received mail ${row.id}`, async (row) => {
    if (await queueReceiveJob({ mailId: row.id, organizationId: row.organizationId, projectId: row.projectId })) result.requeued += 1
  })
  return result
}

export async function sweepLapsedClaims(now: Date): Promise<SweepCounts> {
  const result = counts('returned')
  const rows = await discover('lapsed filing claims', () => sweeps.findLapsedClaims(now, SWEEP_BATCH))
  const told = new Set<string>()
  await eachRow(rows, result, (row) => `the lapsed claim on part ${row.partId}`, async (row) => {
    if (!(await sweeps.returnLapsedClaim(row, now))) return
    result.returned += 1
    publishProjectChanged(row.organizationId, row.projectId)
    if (told.has(row.mailId)) return
    told.add(row.mailId)
    await announceFilingFailed({ ...row, failure: 'unavailable' })
  })
  return result
}

export async function sweepStalledMoves(now: Date): Promise<SweepCounts> {
  const result = counts('moved', 'forgotten', 'held')
  const before = new Date(now.getTime() - STALLED_MOVE_MS)
  const rows = await discover('stalled original moves', () => sweeps.findStalledMoves(before, SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the original move of mail ${row.id}`, async (row) => {
    const mail = await sweeps.findMailRow(row.id)
    if (!mail?.originalMovePendingAt) return
    const entry = await findEntryOfMail(row.projectId, row.id)
    if (entry) {
      if ((await finishOriginalMove(mail, entry)) === 'moved') result.moved += 1
      return
    }
    if (!mail.rawStorageKey) {
      await forgetMovedRaw(row.id)
      result.forgotten += 1
      return
    }
    const raw: sweeps.StalledRaw = { id: mail.id, rawStorageKey: mail.rawStorageKey, originalMovePendingAt: mail.originalMovePendingAt }
    if (!(await sweeps.takeStalledMoveRaw(raw, now))) {
      result.held += 1
      return
    }
    if ((await eraseStagedObjects(mail.stagingBucket, [raw.rawStorageKey]).catch(() => [raw.rawStorageKey])).length > 0) {
      await sweeps.returnStalledMoveRaw(raw, now)
      throw new Error('its staged raw message could not be erased')
    }
    result.forgotten += 1
  })
  return result
}

export async function sweepUnauditedDecisions(now: Date): Promise<SweepCounts> {
  const result = counts('sent')
  const before = new Date(now.getTime() - AUDIT_GRACE_MS)
  const rows = await discover('decisions owed to the audit trail', () => sweeps.findUnauditedDecisions(before, SWEEP_BATCH))
  result.checked = rows.length
  const byOrganization = Map.groupBy(rows, (row) => row.organizationId)
  for (const [organizationId, decisions] of byOrganization) {
    const allTaken = await withTenant({ organizationId }, () => auditDecisions(decisions))
    if (allTaken) result.sent += decisions.length
    else result.errors += 1
  }
  return result
}

export async function sweepExpiredMails(now: Date): Promise<SweepCounts> {
  const result = counts('expired', 'parts')
  const rows = await discover('held mail past its window', () => sweeps.findExpiredMails(now, SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the expiry of mail ${row.id}`, async (row) => {
    const parts = await sweeps.expireMail(row.id, now)
    if (parts === 0) return
    result.expired += 1
    result.parts += parts
    await recordAuditEvent({
      action: 'inbound_mail.expired',
      organizationId: row.organizationId,
      actor: { userId: SYSTEM_ACTORS.inboundMail, email: null },
      targetType: 'inbound_mail',
      targetId: row.id,
      alsoTargets: [{ type: 'project', id: row.projectId }],
      metadata: { projectId: row.projectId, parts },
      occurredAt: now,
      idempotencyKey: `inbound_mail.expired:${row.id}:${now.toISOString()}`,
    })
    captureServer({
      event: 'inbound_mail_expired',
      distinctId: null,
      organizationId: row.organizationId,
      properties: { parts, sender_class: row.senderClass, automatic: row.automatic },
    })
    publishProjectChanged(row.organizationId, row.projectId)
    await decideEndedAttachments(row.projectId, [row.id], now)
    await settleProjectNotices(row.organizationId, row.projectId)
    await settleHeld(row.organizationId, [row.id])
    await announceExpired({ ...row, mailId: row.id })
  })
  return result
}

export async function sweepExpiringMails(now: Date): Promise<SweepCounts> {
  const result = counts('told')
  const rows = await discover('held mail about to expire', () => sweeps.findExpiringMails(now, SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the expiry notice of mail ${row.id}`, async (row) => {
    if (!(await sweeps.claimExpiringNotice(row.id, now))) return
    await announceExpiring({ ...row, mailId: row.id })
    result.told += 1
  })
  return result
}

export async function sweepEndedParts(now: Date): Promise<SweepCounts> {
  const result = counts('erased', 'deferred', 'settled')
  const parts = await discover('ended parts past restoring', () => sweeps.findEndedPartBytes(now, SWEEP_BATCH))
  await eachRow(parts, result, (row) => `the bytes of part ${row.partId}`, async (row) => {
    if (row.held) {
      await sweeps.deferPartErasure(row.partId, now)
      result.deferred += 1
      return
    }
    if (!(await sweeps.takeEndedPartBytes(row, now))) return
    if ((await eraseStagedObjects(row.stagingBucket, [row.storageKey])).length > 0) {
      await sweeps.returnEndedPartKey(row, now)
      throw new Error('its bytes could not be erased')
    }
    result.erased += 1
  })

  const mails = await discover('mail to settle', () => sweeps.findMailsToSettle(now, SWEEP_BATCH))
  await eachRow(mails, result, (row) => `the settle of mail ${row.id}`, async (row) => {
    const mail = await sweeps.findMailRow(row.id)
    if (!mail || mail.status !== 'waiting') return
    if (!(await sweeps.settleEndedMail(mail, row.held, now))) return
    result.settled += 1
    await decideEndedAttachments(row.projectId, [row.id], now)
    publishProjectChanged(row.organizationId, row.projectId)
    await settleProjectNotices(row.organizationId, row.projectId)
    if (!row.held) await eraseSettledMail(mail, now)
  })
  return result
}

async function eraseSettledMail(mail: InboundMailRow, now: Date): Promise<void> {
  const readKey = mail.readStorageKey
  const rawKey = mail.originalMovePendingAt ? null : mail.rawStorageKey
  const keys = [readKey, rawKey].filter((key): key is string => key !== null)
  if (keys.length === 0) return
  const kept = await eraseStagedObjects(mail.stagingBucket, keys).catch(() => keys)
  if (kept.length === 0) return
  const erasure: sweeps.DeferredErasure = { id: mail.id, kind: 'mail', organizationId: mail.organizationId, stagingBucket: mail.stagingBucket, storageKey: null, readKey, rawKey, keys }
  await sweeps.returnReleasedErasure(erasure, kept, now)
  throw new Error('its staged objects could not be erased')
}

export async function sweepFailedScans(now: Date): Promise<SweepCounts> {
  const result = counts('clean', 'infected', 'failed', 'senderFilingQueued')
  const rows = await discover('failed scans', () => sweeps.findFailedScans(now, SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the scan of ${row.kind} ${row.id}`, async (row) => {
    const scan = await scanForStorage(await readStagedObject(row.stagingBucket, row.storageKey))
    const recorded = row.kind === 'part' ? await sweeps.recordPartRescan(row.id, scan) : await sweeps.recordRawRescan(row.id, scan)
    if (!recorded) return
    result[scan.status] = (result[scan.status] ?? 0) + 1
    if (scan.status !== 'clean' || row.senderClass !== 'verified_writer') return
    await queueSenderFiling({ id: row.mailId, organizationId: row.organizationId, projectId: row.projectId })
    result.senderFilingQueued += 1
  })
  return result
}

export const REREAD_BATCH = 5
export const REREAD_BUDGET_MS = 45_000
export const REREAD_MIN_MS = 20_000

export async function sweepUnreadTexts(now: Date, clock: () => number = Date.now): Promise<SweepCounts> {
  const result = counts('read', 'later', 'gone', 'deferred')
  const deadline = clock() + REREAD_BUDGET_MS
  const rows = await discover('texts the reader did not answer for', () => sweeps.findUnreadTexts(now, REREAD_BATCH))
  await eachRow(rows, result, (row) => `the re-read of mail ${row.id}`, async (row) => {
    const left = deadline - clock()
    if (left < REREAD_MIN_MS) return void (result.deferred += 1)
    const leased = await sweeps.leaseReread(row, new Date(clock()))
    if (!leased) return void (result.gone += 1)
    result[await rereadHeldText(leased, left)] += 1
  })
  return result
}

export async function sweepReleasedErasures(now: Date): Promise<SweepCounts> {
  const result = counts('erased')
  const rows = await discover('erasures a released hold deferred', () => sweeps.findReleasedErasures(SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the deferred erasure of ${row.kind} ${row.id}`, async (row) => {
    if (!(await sweeps.takeReleasedErasure(row, now))) return
    const kept = await eraseStagedObjects(row.stagingBucket, row.keys)
    if (kept.length > 0) {
      await sweeps.returnReleasedErasure(row, kept, now)
      throw new Error('its staged objects could not be erased')
    }
    result.erased += 1
  })
  return result
}

export async function sweepKeptMails(now: Date): Promise<SweepCounts> {
  const result = counts('deleted')
  const rows = await discover('mail rows past their keep', () => sweeps.findKeptMails(now, SWEEP_BATCH))
  result.checked = rows.length
  const deleted = await withPlatformAccess('inbound mail sweep 8: deleting mail rows past their keep', () =>
    sweeps.deleteKeptMails(rows.map((row) => row.id), now),
  )
  result.deleted = deleted.length
  return result
}

export async function sweepFollows(now: Date): Promise<SweepCounts> {
  const result = counts('ended', 'told')
  const ending = await discover('follows that end', () => sweeps.findEndingFollows(now, SWEEP_BATCH))
  await eachRow(ending, result, (row) => `the end of follow ${row.id}`, async (row) => {
    if (!(await endFollowBySystem(row, row.reason, now))) return
    result.ended += 1
  })

  const expiring = await discover('follows about to end', () => sweeps.findExpiringFollows(now, SWEEP_BATCH))
  await eachRow(expiring, result, (row) => `the renewal notice of follow ${row.id}`, async (row) => {
    if (!row.threadDocumentId || !(await sweeps.claimFollowExpiringNotice(row.id, now))) return
    await announceFollowExpiring({
      organizationId: row.organizationId,
      projectId: row.projectId,
      followId: row.id,
      threadDocumentId: row.threadDocumentId,
      followerUserId: row.userId,
    })
    result.told += 1
  })
  return result
}

export async function sweepOrphanedThreads(now: Date): Promise<SweepCounts> {
  const result = counts('deleted', 'entries', 'originals')
  const rows = await discover('threads whose document is gone', () => sweeps.findOrphanedThreads(now, SWEEP_BATCH))
  result.checked = rows.length
  for (const row of rows) {
    const holder = randomUUID()
    try {
      const originals = await withPlatformAccess('inbound mail sweep 9: leasing a thread whose document is gone', () =>
        sweeps.claimOrphanedThread(row.id, holder, now),
      )
      if (originals === null) continue
      for (const [bucket, inBucket] of Map.groupBy(originals, (original) => original.bucket)) {
        const keys = inBucket.map((original) => original.key)
        if ((await eraseStagedObjects(bucket, keys)).length > 0) {
          await withPlatformAccess('inbound mail sweep 9: releasing a thread an original stayed in', () =>
            sweeps.releaseOrphanedThread(row.id, holder),
          )
          throw new Error('an original could not be erased')
        }
        result.originals += keys.length
      }
      const entries = await withPlatformAccess('inbound mail sweep 9: deleting a thread whose document is gone', () =>
        sweeps.deleteOrphanedThread(row.id, holder, now),
      )
      if (entries === null) continue
      result.deleted += 1
      result.entries += entries
    } catch (error) {
      result.errors += 1
      console.error(`[inbound-mail] sweep could not delete thread ${row.id}`, error)
    }
  }
  return result
}

export function capNoticeFor(state: Pick<sweeps.AddressCapState, 'revoked' | 'addressBytes' | 'organizationBytes'>): InboundMailCapNotice | null {
  if (state.revoked) return null
  const share = Math.max(
    state.addressBytes / INBOUND_MAIL_ADDRESS_STAGED_BYTES,
    state.organizationBytes / INBOUND_MAIL_ORGANIZATION_STAGED_BYTES,
  )
  if (share >= 1) return 'full'
  return share >= 0.8 ? 'nearly_full' : null
}

const CAP_RANK: Record<InboundMailCapNotice, number> = { nearly_full: 1, full: 2 }
const rank = (notice: InboundMailCapNotice | null) => (notice ? CAP_RANK[notice] : 0)

export async function sweepCaps(now: Date): Promise<SweepCounts> {
  const result = counts('told', 'settled')
  const caps = { address: INBOUND_MAIL_ADDRESS_STAGED_BYTES, organization: INBOUND_MAIL_ORGANIZATION_STAGED_BYTES }
  const rows = await discover('addresses near their caps', () => sweeps.findAddressCapStates(caps, SWEEP_BATCH))
  await eachRow(rows, result, (row) => `the cap notice of address ${row.id}`, async (row) => {
    const notice = capNoticeFor(row)
    if (notice === row.capNotice) return
    if (!(await sweeps.setCapNotice(row.id, row.capNotice, notice, now))) return
    if (rank(notice) > rank(row.capNotice) && notice) {
      await announceCapReached({ organizationId: row.organizationId, projectId: row.projectId, addressId: row.id, notice })
      result.told += 1
    } else if (notice === null) {
      await settleCapReached(row.organizationId, row.id)
      result.settled += 1
    }
  })
  return result
}

const ORDER: ReadonlyArray<[keyof InboundMailSweepResult, (now: Date) => Promise<SweepCounts>]> = [
  ['staleReceptions', sweepStaleReceptions],
  ['orphanedReceptions', sweepOrphanedReceptions],
  ['lapsedClaims', sweepLapsedClaims],
  ['stalledMoves', sweepStalledMoves],
  ['audits', sweepUnauditedDecisions],
  ['expired', sweepExpiredMails],
  ['expiring', sweepExpiringMails],
  ['endedParts', sweepEndedParts],
  ['rescans', sweepFailedScans],
  ['rereads', sweepUnreadTexts],
  ['releasedErasures', sweepReleasedErasures],
  ['keptMails', sweepKeptMails],
  ['follows', sweepFollows],
  ['threads', sweepOrphanedThreads],
  ['caps', sweepCaps],
]

export async function sweepInboundMail(now: Date = new Date()): Promise<InboundMailSweepResult> {
  const result = {} as InboundMailSweepResult
  for (const [name, sweep] of ORDER) {
    try {
      result[name] = await sweep(now)
    } catch (error) {
      console.error(`[inbound-mail] the ${name} sweep failed`, error)
      result[name] = { ...counts(), errors: 1, failed: 1 }
    }
  }
  return result
}

export const SWEEP_ORDER: ReadonlyArray<keyof InboundMailSweepResult> = ORDER.map(([name]) => name)
