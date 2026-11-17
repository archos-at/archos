import 'server-only'
import type { ZodType } from 'zod'
import { ApiError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { LimitRule } from '@/lib/limits'
import type { RealtimePeer, UpstreamBase } from './types'

export interface ChannelDefinition<TParams = unknown, TUp extends UpstreamBase = UpstreamBase> {
  readonly kind: string
  parse(id: string): TParams | null
  topics(params: TParams, organizationId: string): readonly [string, ...string[]]
  authorize(session: AuthorizedSession, params: TParams): Promise<void>
  authorizeSend?(session: AuthorizedSession, params: TParams): Promise<void>
  readonly reauthorizeMs: number
  readonly events: ZodType<{ kind: string }>
  readonly upstream?: {
    readonly schema: ZodType<TUp>
    readonly limit: LimitRule
    readonly claims?: { readonly limit: LimitRule; readonly fields?: readonly string[] }
    handle(msg: TUp, peer: RealtimePeer, params: TParams): Array<{ kind: string }>
  }
  readonly presence?: { readonly ttlMs: number; readonly refreshMs: number }
  observe?(events: ReadonlyArray<{ kind: string }>, params: TParams, organizationId: string): void
}

export function defineChannel<TParams, TUp extends UpstreamBase = UpstreamBase>(
  definition: ChannelDefinition<TParams, TUp>
): ChannelDefinition<TParams, TUp> {
  return definition
}

export type AnyChannel = ChannelDefinition<unknown, UpstreamBase>

export function isAccessRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)
}

const grants = new Map<string, number>()
const MAX_GRANTS = 5_000

const grantKey = (session: AuthorizedSession, key: string) => `${session.organizationId}:${session.userId}:${key}`

export async function authorizeSendCached(
  session: AuthorizedSession,
  channel: AnyChannel,
  params: unknown,
  key: string,
  now = Date.now()
): Promise<void> {
  const id = grantKey(session, key)
  const until = grants.get(id)
  if (until && until > now) return
  await (channel.authorizeSend ?? channel.authorize).call(channel, session, params)
  if (grants.size >= MAX_GRANTS) grants.clear()
  grants.set(id, now + channel.reauthorizeMs)
}

export function forgetSendGrant(session: AuthorizedSession, key: string): void {
  grants.delete(grantKey(session, key))
}

export function __resetGrantsForTests(): void {
  grants.clear()
}
