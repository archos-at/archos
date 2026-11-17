import 'server-only'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { databaseUnavailableCode } from '@/lib/db/errors'
import { loadOrganizationDirectoryStrict } from '@/lib/sharing/directory'
import { asciiLower } from './address'
import { MailReadRefusedError, readMail, unreadableRead, type MailRead } from './read-client'
import { claimsMemberName } from './sender-risk'
import { stagedObjectUrlForBackend } from './staging'

export const RECEIVE_DEPENDENCIES = ['directory', 'write_check', 'dkim_dns', 'reader', 'object_store', 'database'] as const
export type ReceiveDependency = (typeof RECEIVE_DEPENDENCIES)[number]

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

export const RECEIVE_FAULT_WAITS_MS: readonly number[] = [1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60].map((minutes) => minutes * MINUTE)

export const RECEIVE_FAULT_BUDGET = RECEIVE_FAULT_WAITS_MS.length

export const DKIM_DNS_FAULT_WAITS_MS: readonly number[] = [2, 10].map((minutes) => minutes * MINUTE)

export const DKIM_DNS_FAULT_BUDGET = DKIM_DNS_FAULT_WAITS_MS.length

export interface FaultCounts {
  faults?: number
  dkimFaults?: number
}

export function nextFaultTry<T extends FaultCounts>(
  dependency: ReceiveDependency,
  payload: T,
  now: Date,
): { payload: T; notBefore: Date; budget: number } | null {
  const dkim = dependency === 'dkim_dns'
  const spent = (dkim ? payload.dkimFaults : payload.faults) ?? 0
  const wait = (dkim ? DKIM_DNS_FAULT_WAITS_MS : RECEIVE_FAULT_WAITS_MS)[spent]
  if (wait === undefined) return null
  const counts = dkim ? { dkimFaults: spent + 1 } : { faults: spent + 1 }
  return { payload: { ...payload, ...counts }, notBefore: new Date(now.getTime() + wait), budget: dkim ? DKIM_DNS_FAULT_BUDGET : RECEIVE_FAULT_BUDGET }
}

export function dependencyOf(error: unknown): ReceiveDependency | null {
  if (error instanceof DependencyFaultError) return error.dependency
  return databaseUnavailableCode(error) ? 'database' : null
}

export async function fromObjectStore<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!isObjectStoreFault(error)) throw error
    throw new DependencyFaultError('object_store', error)
  }
}

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

const TIMEOUT_ERROR_NAMES = new Set(['TimeoutError', 'RequestTimeout', 'RequestTimeoutException'])

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

export interface SenderIdentity {
  memberUserId: string | null
  claimsMemberName: boolean
  unchecked: boolean
}

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
