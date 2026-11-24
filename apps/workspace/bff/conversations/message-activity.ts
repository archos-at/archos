import 'server-only'
import type { Message } from '@/lib/db/schema/messages'
import type { ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { publishToUsers } from '@/lib/events/bus'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems } from '@/lib/inbox/service'
import { isShared } from '@/lib/sharing/access'
import { countGrantsForResource } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { findConversationInOrg } from './repository'

interface FanOutInput {
  shared?: boolean
  organizationId: string
  conversationId: string
  visibility: ResourceVisibility
  actorUserId: string | null
  rows: Message[]
  turnStartedFor: readonly string[]
  emitAmbient: boolean
  title?: string | null
}

export async function fanOutMessageActivity(input: FanOutInput): Promise<void> {
  const { organizationId, conversationId, actorUserId } = input
  if (input.rows.length === 0) return

  try {
    const shared =
      input.shared ??
      isShared(
        input.visibility,
        input.visibility === 'private'
          ? await countGrantsForResource('conversation', conversationId)
          : 0
      )
    if (!shared) return

    const participants = await resolveParticipants(organizationId, 'conversation', conversationId)
    if (participants.length === 0) return

    for (const row of input.rows) {
      await publishToUsers(participants, {
        kind: 'conversation.message',
        conversationId,
        authorUserId: row.authorUserId,
        messageId: row.id,
      })
      if (input.turnStartedFor.includes(row.id)) {
        await publishToUsers(participants, {
          kind: 'conversation.turn',
          conversationId,
          phase: 'started',
          actorUserId,
        })
      }
      if (row.role === 'assistant') {
        await publishToUsers(participants, {
          kind: 'conversation.turn',
          conversationId,
          phase: 'ended',
          actorUserId,
        })
      }
    }

    if (!input.emitAmbient) return

    const subject =
      input.title ?? (await findConversationInOrg(conversationId, organizationId))?.title ?? null

    await emitInboxItems(
      participants.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        type: 'conversation.activity' as const,
        resourceType: 'conversation' as const,
        resourceId: conversationId,
        actorUserId,
        payload: subject ? { subject } : {},
        groupKey: inboxGroupKey('conversation.activity', 'conversation', conversationId),
      }))
    )
  } catch (error) {
    console.warn('[conversations] participant fan-out failed (non-fatal):', error)
  }
}
