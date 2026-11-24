'use client'

import { memo, type JSX } from 'react'
import { Crosshair, Sparkles, SquareDashed } from 'lucide-react'
import { motion, springGlide, useMotionToken } from '@/components/motion'
import { identityInk } from '@/components/ui/avatar-identity'
import { LiveCursor } from '@/components/ui/live-cursor'
import { WorkingDots } from '@/components/ui/working-dots'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { presenceCopy } from '@/i18n/namespaces/presence'
import type { RoomPeerState } from '../../../hooks/use-document-room'
import { useRestedFor } from '../../../hooks/use-rested-for'
import { AGENT_REST_MS, agentCursorLabel, agentForShort, CURSOR_IDLE_MS, isAgentPeer } from '../../../lib/review-peer-state'

function AgentCursor({ state, idle }: { state: RoomPeerState; idle?: boolean }): JSX.Element {
  const tPresence = useTranslations(presenceCopy)
  const forShort = agentForShort(state.peer)
  const dots = state.activity ? <WorkingDots className="ml-0.5" /> : undefined
  return (
    <LiveCursor
      color="var(--paper-ink)"
      idle={idle}
      label={agentCursorLabel(state, tPresence('piloti.reading', { page: state.activity?.box?.page ?? 1 }))}
      icon={<Sparkles className="size-3" aria-hidden />}
      busy={
        forShort ? (
          <>
            <span data-testid="agent-cursor-for" className="shrink-0">
              {tPresence('piloti.forSuffix', { name: forShort })}
            </span>
            {dots}
          </>
        ) : (
          dots
        )
      }
    />
  )
}

function GlidingCursor({
  x,
  y,
  size,
  children,
}: {
  x: number
  y: number
  size: { width: number; height: number }
  children: JSX.Element
}): JSX.Element {
  const glide = useMotionToken(springGlide)
  return (
    <motion.span
      className="pointer-events-none absolute top-0 left-0"
      initial={false}
      animate={{ x: x * size.width, y: y * size.height }}
      transition={glide}
    >
      {children}
    </motion.span>
  )
}

export const PeerPointer = memo(function PeerPointer({
  state,
  size,
  focused,
  agentThinking,
}: {
  state: RoomPeerState & { cursor: NonNullable<RoomPeerState['cursor']> }
  size: { width: number; height: number }
  focused: boolean
  agentThinking: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const agent = isAgentPeer(state)
  const rested = useRestedFor(state.movedAt, agent ? AGENT_REST_MS : CURSOR_IDLE_MS)
  return (
    <GlidingCursor x={state.cursor.x} y={state.cursor.y} size={size}>
      {agent ? (
        <AgentCursor state={state} idle={rested && !agentThinking && !state.activity} />
      ) : (
        <LiveCursor
          color={identityInk(state.peer.userId)}
          label={state.peer.name}
          tag={focused}
          chat={focused ? state.chat : null}
          idle={!state.chat && rested}
          busy={
            state.tool === 'region' ? (
              <SquareDashed className="size-3" aria-label={t('review.peerRegion')} />
            ) : state.tool === 'point' ? (
              <Crosshair className="size-3" aria-label={t('review.peerPoint')} />
            ) : undefined
          }
        />
      )}
    </GlidingCursor>
  )
})
