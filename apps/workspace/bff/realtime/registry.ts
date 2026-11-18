import 'server-only'
import type { AnyChannel } from './channel'
import { documentChannel } from './document-channel'
import { proposalChannel } from './proposal-channel'
import { shelfChannel } from './shelf-channel'
import { channelKind } from './types'

export const CHANNELS: Readonly<Record<string, AnyChannel>> = {
  [documentChannel.kind]: documentChannel as AnyChannel,
  [proposalChannel.kind]: proposalChannel as AnyChannel,
  [shelfChannel.kind]: shelfChannel as AnyChannel,
}

export interface ResolvedChannel {
  key: string
  channel: AnyChannel
  params: unknown
}

export function resolveChannel(key: string, channels: Readonly<Record<string, AnyChannel>> = CHANNELS): ResolvedChannel | null {
  const kind = channelKind(key)
  if (!kind) return null
  const channel = Object.hasOwn(channels, kind) ? channels[kind] : undefined
  if (!channel) return null
  const params = channel.parse(key.slice(kind.length + 1))
  return params === null ? null : { key, channel, params }
}
