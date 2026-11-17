import type { DraftMention } from '@/lib/mentions/mention-text'
import { MENTION_ERROR_REASONS } from '@/lib/mentions/types'
import { SHARING_ERROR_REASONS } from '@/lib/sharing/types'
import type { SendMessageOutcome } from '@/features/chat/hooks/use-websocket-chat'

export function normalizeSendResult(result: unknown): {
  ok: boolean
  outcome?: SendMessageOutcome
} {
  if (result === false) return { ok: false }
  if (result && typeof result === 'object' && 'ok' in result) {
    const outcome = result as SendMessageOutcome
    return { ok: outcome.ok, outcome }
  }
  return { ok: true }
}

export function mentionRefusalMessage(
  outcome: SendMessageOutcome | undefined,
  taggedHumans: readonly DraftMention[],
  tCollab: (key: string, vars?: Record<string, string | number>) => string
): string | null {
  const reason = outcome?.failure?.reason
  if (!reason) return null
  const refused = outcome?.failure?.targetId
  const name =
    (refused ? taggedHumans.find((mention) => mention.targetId === refused)?.display : undefined) ??
    taggedHumans[0]?.display ??
    ''
  switch (reason) {
    case MENTION_ERROR_REASONS.inviteRequiresOwner:
      return tCollab('mentions.errors.inviteRequiresOwner', { name })
    case MENTION_ERROR_REASONS.containerAccessRequired:
      return tCollab('mentions.errors.containerAccessRequired', { name })
    case MENTION_ERROR_REASONS.rateLimited:
      return tCollab('mentions.errors.rateLimited')
    case SHARING_ERROR_REASONS.restrictedContent:
      return name
        ? tCollab('sharing.errors.restrictedContent', { name })
        : tCollab('sharing.errors.restrictedContentSomeone')
    case SHARING_ERROR_REASONS.crossProjectContent:
      return name
        ? tCollab('sharing.errors.crossProjectContent', { name })
        : tCollab('sharing.errors.crossProjectContentSomeone')
    default:
      return null
  }
}

export const TEXTAREA_MAX_HEIGHT_PX = 208

const SOFT_KEYBOARD_MIN_OCCLUSION_PX = 100

function softKeyboardIsUp(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  if (!window.matchMedia('(pointer: coarse)').matches) return false
  const viewport = window.visualViewport
  if (
    viewport &&
    document.documentElement.clientHeight - viewport.height * viewport.scale >
      SOFT_KEYBOARD_MIN_OCCLUSION_PX
  ) {
    return true
  }
  return 'virtualKeyboard' in navigator
}

export function releaseSoftKeyboard(el: HTMLTextAreaElement | null): void {
  if (el && softKeyboardIsUp()) el.blur()
}

export const SEND_CONTROL_SWAP_GUARD_MS = 400

export const FIELD_SIZING_CONTENT =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('field-sizing', 'content')
