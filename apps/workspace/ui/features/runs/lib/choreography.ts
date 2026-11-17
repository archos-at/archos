import {
  motionDeliberate,
  motionQuick,
  motionQuickExit,
  motionSnap,
  springSnapSettleSeconds,
  staggerStepSeconds,
} from '@/components/motion'
import { isTerminalRunStatus, type RunStatus } from '@/lib/runs/run-ledger-types'

export interface LandingDelays {
  glyph: number
  word: number
  fold: number | null
  footer: number
  report: number
}

const seconds = (duration: number | undefined): number => duration ?? 0

const GLYPH_SWAP = 2 * seconds(motionSnap.duration)
const WORD_SWAP = 2 * seconds(motionQuick.duration)

export function landingDelays(status: RunStatus): LandingDelays {
  const glyph = status === 'done' ? springSnapSettleSeconds : 0
  const word = glyph + GLYPH_SWAP
  const wordDone = word + WORD_SWAP
  const fold = isTerminalRunStatus(status) ? wordDone + seconds(motionDeliberate.duration) : null
  const footer = fold === null ? wordDone : fold + seconds(motionQuickExit.duration)
  const report = footer + 2 * staggerStepSeconds
  return { glyph, word, fold, footer, report }
}
