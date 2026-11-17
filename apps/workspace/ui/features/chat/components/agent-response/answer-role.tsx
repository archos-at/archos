import type { AgentResponseProps } from './agent-response-props'
import { type FC } from 'react'

import type { AnswerKind } from '@/lib/conversations/message-answer-meta'

export function answerRole(
  kind: AnswerKind | undefined,
  routingDecision: AgentResponseProps['routingDecision'],
  hasVerdict: boolean
): 'note' | 'answer' | 'result' {
  if (kind === 'direct' || kind === 'handoff') return 'note'
  if (kind === 'walkthrough' || kind === 'work') return 'answer'
  if (kind === 'ruling' || (!kind && hasVerdict)) return 'result'
  if (routingDecision === 'meta') return 'note'
  return 'result'
}

export const StreamingCaret: FC<{ fading?: boolean; veil?: boolean; idle?: boolean }> = ({
  fading = false,
  veil = false,
  idle = false,
}) => (
  <span
    aria-hidden="true"
    data-testid="streaming-caret"
    data-idle={idle ? 'true' : undefined}
    className={`group/caret duration-base relative inline-block h-0 w-0 transition-opacity ease-out ${fading ? 'opacity-0' : 'opacity-100'}`}
  >
    {veil && (
      <span className="pointer-events-none absolute right-0 -bottom-[0.3em] h-[1.4em] w-[2.5em] bg-[linear-gradient(to_right,transparent,color-mix(in_oklab,var(--card)_30%,transparent)_45%,var(--card))] in-data-[caret-after=markup]:hidden contrast-more:hidden forced-colors:hidden" />
    )}
    <span className="bg-foreground/70 group-data-[idle=true]/caret:animate-caret-breathe absolute -bottom-[0.2em] left-px h-[1.1em] w-[2px] rounded-full motion-reduce:animate-none forced-colors:bg-[CanvasText]" />
  </span>
)
