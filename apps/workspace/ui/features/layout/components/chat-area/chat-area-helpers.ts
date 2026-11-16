import type { ChatMessage } from '@/features/chat/types'
import type { ThinkingEnding } from '@/features/chat/components/ChatThinking'
import type { TurnView } from '@/lib/turns/turn-fold'
import { motionQuickExit } from '@/components/motion'

const GIST_MAX_CHARS = 120

export const answerGist = (answer: ChatMessage): string => {
  const verdict = answer.answerMeta?.verdict
  if (verdict) return `${verdict.subject}: ${verdict.value}`
  const plain = answer.content
    .replace(/\[\d+\]/g, '')
    .replace(/[#*_`>|~]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain
  if (sentence.length <= GIST_MAX_CHARS) return sentence
  const cut = sentence.slice(0, GIST_MAX_CHARS)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 0)) || cut}…`
}

const REFUSAL_CODES: ReadonlySet<string> = new Set(['research.queue_full', 'budget.exhausted'])

export const turnEnding = (
  view: TurnView | undefined,
  turnMessages: ChatMessage[],
  failed: boolean
): ThinkingEnding | undefined => {
  if (
    view?.outcome === 'handed_off' ||
    view?.result?.run ||
    turnMessages.some((m) => m.runLedger)
  ) {
    return 'handed_off'
  }
  const refusedByBanner = turnMessages.some(
    (m) => m.messageType === 'error' && REFUSAL_CODES.has(m.errorData?.errorCode ?? '')
  )
  if (view?.outcome === 'refused' || view?.result?.job_admission_rejected || refusedByBanner)
    return 'refused'
  return failed ? 'failed' : undefined
}

export const RECONNECTED_NOTE_MS = 2400

export const NO_MESSAGES: ChatMessage[] = []

export const ROW_GAP_PX = 16

export const FOLD_HOLD_MS = (motionQuickExit.duration ?? 0.18) * 1000 + 34

const COMPOSER_FALLBACK_PX = 176
const LIST_END_GAP_PX = 24
export const UNSEEN_SLACK_PX = 24
export const READER_SCROLL_MS = 300
export const GESTURE_SETTLE_MS = 150
export const RETRY_ANCHOR_WINDOW_MS = 1000

export const layoutTop = (el: HTMLElement): number => {
  const top = el.getBoundingClientRect().top
  const transform = getComputedStyle(el).transform
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly === 'undefined') return top
  try {
    return top - new DOMMatrixReadOnly(transform).m42
  } catch {
    return top
  }
}

export const visibleBottom = (container: HTMLElement): number => {
  const composer = Number.parseFloat(getComputedStyle(container).getPropertyValue('--composer-h'))
  const covered = (Number.isFinite(composer) ? composer : COMPOSER_FALLBACK_PX) + LIST_END_GAP_PX
  return container.getBoundingClientRect().bottom - covered
}
