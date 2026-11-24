import { isAgentKind } from '@/lib/agent-kind'
import { PRODUCT_NAME } from '@/lib/brand'
import type { RoomPeerState } from '../hooks/use-document-room'

export const isAgentPeer = (state: RoomPeerState): boolean => isAgentKind(state.peer.kind)

export function agentForShort(peer: Pick<RoomPeerState['peer'], 'forName'>): string | null {
  const first = peer.forName?.trim().split(/\s+/)[0]?.split('@')[0]
  return first || null
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0]?.split('@')[0] || name

export function agentCursorLabel(state: Pick<RoomPeerState, 'label' | 'activity'>, reading: string): string {
  const doing = state.label || state.activity?.label || (state.activity?.state === 'reading' ? reading : null)
  return doing ? `${PRODUCT_NAME} · ${doing}` : PRODUCT_NAME
}

export const CURSOR_IDLE_MS = 8_000

export const AGENT_REST_MS = 3_000

export function agentResting(
  state: Pick<RoomPeerState, 'activity' | 'movedAt'>,
  now: number,
  thinking: boolean
): boolean {
  return !thinking && !state.activity && state.movedAt !== null && now - state.movedAt > AGENT_REST_MS
}

export function peerSelections(
  peers: readonly RoomPeerState[],
  selfUserId: string | null
): Map<string, RoomPeerState[]> {
  const byMark = new Map<string, RoomPeerState[]>()
  for (const state of peers) {
    if (!state.selected || isAgentPeer(state) || state.peer.userId === selfUserId) continue
    const here = byMark.get(state.selected) ?? []
    if (!here.some((other) => other.peer.userId === state.peer.userId)) byMark.set(state.selected, [...here, state])
  }
  return byMark
}

export const selectionsKey = (selections: Map<string, RoomPeerState[]>): string =>
  [...selections].map(([id, states]) => `${id}:${states.map((state) => state.peer.peerId).join(',')}`).join('|')
