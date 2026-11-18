import { parseWireEvent } from '@/adapters/api/wire-v2'
import { foldTurnEvents } from '@/lib/turns/turn-fold'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import type { TimedStep } from './work-list-scene-steps'

export const SCENE_ORIGIN = Date.UTC(2026, 9, 22, 10, 0, 0)

export const foldScene = (
  scene: readonly TimedStep[],
  origin: number = SCENE_ORIGIN
): StoredThinkingStep[] => {
  const events = scene.map(({ at, type, step }, index) => {
    const event = parseWireEvent({
      v: 2,
      conversation_id: 'conv_scene',
      turn_id: 'turn-scene',
      seq: index + 1,
      ts: origin + at,
      type,
      step,
    })
    if (!event) throw new Error(`not a v2 event: ${JSON.stringify(step)}`)
    return event
  })
  const view = foldTurnEvents(undefined, events)
  return view ? view.stepOrder.map((id) => view.steps[id]) : []
}
