import type { AddresseeSet } from '@/lib/mentions/types'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import type { CanvasFocus } from './canvas-bridge'

export interface SendMessageMention {
  targetId: string
  display: string
}

export interface SendMessageOptions {
  mentions?: readonly SendMessageMention[]
  mentionNote?: string | null
  awaitingHuman?: boolean
  reasoningEffort?: ChatEffort
  canvas?: CanvasFocus
}

export interface SendMessageFailure {
  reason: string | null
  message: string | null
  targetId?: string | null
}

export interface SendMessageOutcome {
  ok: boolean
  addressees?: AddresseeSet
  failure?: SendMessageFailure
}

export async function readSendFailure(response: Response): Promise<SendMessageFailure> {
  try {
    const body = (await response.json()) as {
      error?: string
      details?: { reason?: string; targetId?: string } | null
    }
    return {
      reason: body.details?.reason ?? null,
      message: body.error ?? null,
      targetId: body.details?.targetId ?? null,
    }
  } catch {
    return { reason: null, message: null }
  }
}

export function readAddresseeRuling(body: unknown, messageId: string): AddresseeSet | null {
  const rows = (Array.isArray(body) ? body : [body]) as Array<{
    id?: string
    addressees?: AddresseeSet
  } | null>
  const row = rows.find((entry) => entry?.id === messageId) ?? null
  const addressees = row?.addressees
  if (!addressees || typeof addressees.agent !== 'boolean' || !Array.isArray(addressees.users)) {
    return null
  }
  return addressees
}
