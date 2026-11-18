import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { foldTurnEvents, type TurnView } from '@/lib/turns/turn-fold'
import { eventOf, frameOf, wireEvents } from './wire-v2-fixtures'

const rowsOf = (view: TurnView | undefined): StoredThinkingStep[] =>
  view ? view.stepOrder.map((id) => view.steps[id]) : []

const stepEvent = (seq: number, step: Record<string, unknown>) =>
  eventOf(
    frameOf(seq, {
      type:
        step.kind === 'tool' && (step.status ?? 'running') === 'running'
          ? 'STEP_STARTED'
          : 'STEP_FINISHED',
      step,
    })
  )

export const storedSteps = (steps: Record<string, unknown>[]): StoredThinkingStep[] =>
  rowsOf(
    foldTurnEvents(
      undefined,
      steps.map((step, i) => stepEvent(i + 1, step))
    )
  )

export const storedStep = (step: Record<string, unknown>): StoredThinkingStep =>
  storedSteps([step])[0]

export const fixtureSteps = (file: string): StoredThinkingStep[] =>
  rowsOf(foldTurnEvents(undefined, wireEvents(file)))
