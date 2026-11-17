import {
  humanMentions,
  reconcileMentions,
  type DraftMention,
} from '@/lib/mentions/mention-text'

export type AddresseeMode = 'agent' | 'people' | 'thread'

export type SendRouting =
  | { readonly kind: 'fast' }
  | { readonly kind: 'mentions'; readonly mentions: DraftMention[] }
  | { readonly kind: 'awaiting' }

export interface AddresseeInput {
  readonly text: string
  readonly mentions: readonly DraftMention[]
  readonly awaitingHuman: boolean
  readonly canCollaborate: boolean
}

export interface Addressee {
  readonly mentions: DraftMention[]
  readonly humans: DraftMention[]
  readonly agentTagged: boolean
  readonly mode: AddresseeMode
  readonly routing: SendRouting
}

export function resolveAddressee(input: AddresseeInput): Addressee {
  if (!input.canCollaborate) {
    return {
      mentions: [],
      humans: [],
      agentTagged: false,
      mode: 'agent',
      routing: { kind: 'fast' },
    }
  }

  const mentions = reconcileMentions(input.text.trim(), input.mentions)
  const humans = humanMentions(mentions)
  const agentTagged = mentions.length > humans.length

  const mode: AddresseeMode =
    humans.length > 0 ? 'people' : agentTagged || !input.awaitingHuman ? 'agent' : 'thread'

  const routing: SendRouting =
    mentions.length > 0
      ? { kind: 'mentions', mentions }
      : input.awaitingHuman
        ? { kind: 'awaiting' }
        : { kind: 'fast' }

  return { mentions, humans, agentTagged, mode, routing }
}

export function sendMessageOptions(
  routing: SendRouting,
): { mentions: DraftMention[] } | { awaitingHuman: true } | undefined {
  switch (routing.kind) {
    case 'mentions':
      return { mentions: routing.mentions }
    case 'awaiting':
      return { awaitingHuman: true }
    case 'fast':
      return undefined
  }
}
