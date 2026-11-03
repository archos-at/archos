/**
 * What the receive job (`./receive-job.ts`) does when something it depends on
 * does not answer (ADR-0137; B3 of the 2026-11 ship review).
 *
 * The queue gives a job three quick attempts, 30 s and 60 s apart
 * (`lib/jobs-queue/attempts.ts`, `workers/job-queue.js`). That is right for a
 * bug and wrong for a dependency: a WorkOS blip or a rolling deploy of the
 * Python reader outlasts it, and a mail held on its last attempt kept whatever
 * the outage made of it, frozen (`inbound_mails_sender_verdict_guard`): a
 * member's mail labelled a stranger's and discarded after 14 days, a writer's
 * mail labelled read-only, a text unreadable for good.
 *
 * So a dependency fault is not an attempt. The job gives its claim back
 * (`notBefore`, the attempt not spent, as the sender job waits for its
 * suggestion) and tries again after 1, 2, 4, 8, 16 and 32 minutes, then
 * hourly: {@link RECEIVE_FAULT_WAITS_MS}, about six hours in all. Only once
 * that is spent does it hold the mail with what it could not learn, and it
 * says so rather than guess:
 *
 * - the directory or the write check (WorkOS): flag `sender_unchecked`, the
 *   30-day window even for a mail it cannot tie to a member (the database
 *   holds the pairing), never a verified writer's;
 * - DNS for DKIM: the verifier's own transient reason, kept as the verdict;
 * - the Python reader: the text held unreadable with `reader_fault_at`, which
 *   the sweep reads again while the mail waits (`./receive-reread.ts`).
 *
 * What is a dependency here: {@link DependencyFaultError}, thrown where the
 * job asks one, and a database that is unreachable (`databaseUnavailableCode`).
 * The object store faults only when it does not answer ({@link isObjectStoreFault}).
 * Anything else is a bug and spends an attempt.
 */

import 'server-only'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { databaseUnavailableCode } from '@/lib/db/errors'
import { loadOrganizationDirectoryStrict } from '@/lib/sharing/directory'
import { asciiLower } from './address'
import { MailReadRefusedError, readMail, unreadableRead, type MailRead } from './read-client'
import { claimsMemberName } from './sender-risk'
import { stagedObjectUrlForBackend } from './staging'

/** What the receive job asks that may not answer. */
export const RECEIVE_DEPENDENCIES = ['directory', 'write_check', 'dkim_dns', 'reader', 'object_store', 'database'] as const
export type ReceiveDependency = (typeof RECEIVE_DEPENDENCIES)[number]

/** A dependency did not answer: the job tries again later without spending an attempt. */
export class DependencyFaultError extends Error {
  constructor(
    readonly dependency: ReceiveDependency,
    cause?: unknown,
  ) {
    super(`the ${dependency} did not answer`, { cause })
    this.name = 'DependencyFaultError'
  }
}

const MINUTE = 60_000

/**
 * How long the job waits after each fault: doubling from a minute to 32, then
 * hourly. 363 minutes in all, so a mail is held at most about six hours late,
 * and only when a dependency was down for all of them.
 */
export const RECEIVE_FAULT_WAITS_MS: readonly number[] = [1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60].map((minutes) => minutes * MINUTE)

/** Faults the job waits out before it holds the mail with what it could not learn. */
export const RECEIVE_FAULT_BUDGET = RECEIVE_FAULT_WAITS_MS.length

/** When to try again after `faults` earlier faults, or null once the budget is spent. */
export function nextFaultTry(faults: number, now: Date): Date | null {
  const wait = RECEIVE_FAULT_WAITS_MS[faults]
  return wait === undefined ? null : new Date(now.getTime() + wait)
}

/** The dependency a failure stands for, or null for anything else (a bug, which spends an attempt). */
export function dependencyOf(error: unknown): ReceiveDependency | null {
  if (error instanceof DependencyFaultError) return error.dependency
  return databaseUnavailableCode(error) ? 'database' : null
}

/**
 * Run a call to the object store. Only a store that did not answer is its
 * fault ({@link isObjectStoreFault}); a missing object, any other 4xx and an
 * error raised before the request left (Node's `ERR_INVALID_CHAR` on a header)
 * are failures of this run, and spend an attempt as any bug does.
 */
export async function fromObjectStore<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!isObjectStoreFault(error)) throw error
    throw new DependencyFaultError('object_store', error)
  }
}

/** Node's and undici's codes for a connection that failed, was cut, or timed out. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

/** The names the AWS SDK and `AbortSignal.timeout` give a request that timed out. */
const TIMEOUT_ERROR_NAMES = new Set(['TimeoutError', 'RequestTimeout', 'RequestTimeoutException'])

/**
 * Whether the object store failed to answer: a network error, a timeout, or a
 * 5xx (a 408 and a 429 are the store saying so too). A status the store sent
 * is decisive; without one, the error and its causes are asked for a network
 * code or a timeout. Anything else, a 4xx or a client-side error, is no fault:
 * waiting six hours for it to change re-ran every scan eleven times for a mail
 * that was going to fail anyway (R1 of the second 2026-11 ship review).
 */
export function isObjectStoreFault(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { name?: unknown; code?: unknown; cause?: unknown; $metadata?: { httpStatusCode?: unknown } }
    const status = candidate.$metadata?.httpStatusCode
    if (typeof status === 'number') return status >= 500 || status === 408 || status === 429
    if (typeof candidate.code === 'string' && NETWORK_ERROR_CODES.has(candidate.code)) return true
    if (typeof candidate.name === 'string' && TIMEOUT_ERROR_NAMES.has(candidate.name)) return true
    current = candidate.cause
  }
  return false
}

// ---------------------------------------------------------------------------
// The asks that may fault
// ---------------------------------------------------------------------------

/** Who the From is in the office's directory, and whether that could be asked at all. */
export interface SenderIdentity {
  memberUserId: string | null
  claimsMemberName: boolean
  /** The directory did not answer within the budget: nobody is named, and the mail is flagged `sender_unchecked`. */
  unchecked: boolean
}

/**
 * The member whose address the From is, exact after ASCII lower-casing
 * (display names never make a member, D4), and whether an outsider's display
 * name claims a member's (`claims_member_name`, `./sender-risk`). A directory
 * that does not answer is a fault, never an empty office: an empty one would
 * label a member's mail a stranger's. `degraded` (the budget is spent) holds
 * the mail as unchecked instead.
 */
export async function senderIdentityFor(
  organizationId: string,
  fromAddress: string | null,
  fromName: string | null,
  degraded: boolean,
): Promise<SenderIdentity> {
  if (!fromAddress) return { memberUserId: null, claimsMemberName: false, unchecked: false }
  let directory: Awaited<ReturnType<typeof loadOrganizationDirectoryStrict>>
  try {
    directory = await loadOrganizationDirectoryStrict(organizationId)
  } catch (error) {
    if (!degraded) throw new DependencyFaultError('directory', error)
    return { memberUserId: null, claimsMemberName: false, unchecked: true }
  }
  const wanted = asciiLower(fromAddress.trim())
  for (const person of directory.values()) {
    if (person.email && asciiLower(person.email.trim()) === wanted) {
      return { memberUserId: person.userId, claimsMemberName: false, unchecked: false }
    }
  }
  const names = [...directory.values()].map((person) => person.name)
  return { memberUserId: null, claimsMemberName: claimsMemberName(fromName, names), unchecked: false }
}

/**
 * Step 8, the Python reader. A refusal (422) is permanent and reads as
 * unreadable; any other failure is a fault of the reader. `degraded` holds the
 * text unreadable with `readerFault`, for the sweep to read again.
 */
export async function readHeldText(
  mail: Pick<InboundMailRow, 'id' | 'stagingBucket' | 'rawStorageKey'>,
  degraded: boolean,
): Promise<{ read: MailRead; readerFault: boolean }> {
  try {
    return { read: await readMail(await stagedObjectUrlForBackend(mail.stagingBucket, mail.rawStorageKey as string)), readerFault: false }
  } catch (error) {
    if (error instanceof MailReadRefusedError) {
      console.error(`[inbound-mail] the reader refused mail ${mail.id}; its text is held as unreadable`)
      return { read: unreadableRead('failed'), readerFault: false }
    }
    if (!degraded) throw new DependencyFaultError('reader', error)
    return { read: unreadableRead('failed'), readerFault: true }
  }
}
