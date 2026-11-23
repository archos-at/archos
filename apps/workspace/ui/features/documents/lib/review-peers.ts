import { isAgentKind } from '@/lib/agent-kind'
import type { RoomPeerState } from '../hooks/use-document-room'

export function people(peers: readonly RoomPeerState[]): RoomPeerState[] {
  const byUser = new Map<string, RoomPeerState>()
  for (const state of peers) {
    if (!isAgentKind(state.peer.kind) && !byUser.has(state.peer.userId)) byUser.set(state.peer.userId, state)
  }
  return [...byUser.values()]
}

export interface RoomCompany {
  people: Array<{ peerId: string; userId: string; name: string; page: number | null }>
  piloti: { forName: string | null; working: boolean; label: string | null } | null
}

export function roomCompanyOf(peers: readonly RoomPeerState[]): RoomCompany {
  const agent = peers.find((state) => isAgentKind(state.peer.kind)) ?? null
  return {
    people: people(peers).map((state) => ({
      peerId: state.peer.peerId,
      userId: state.peer.userId,
      name: state.peer.name,
      page: pageOf(state),
    })),
    piloti: agent
      ? { forName: agent.peer.forName ?? null, working: Boolean(agent.activity), label: agent.activity?.label ?? null }
      : null,
  }
}

export const pageOf = (state: RoomPeerState): number | null => state.cursor?.page ?? state.viewport?.page ?? null

export type PeerSide = 'here' | 'above' | 'below'

export function peerSide(
  at: { page: number; y: number },
  viewPage: number,
  pageRect: { top: number; height: number } | null,
  view: { top: number; bottom: number } | null
): PeerSide {
  if (pageRect && view && pageRect.height > 0) {
    const y = pageRect.top + at.y * pageRect.height
    return y < view.top ? 'above' : y > view.bottom ? 'below' : 'here'
  }
  return at.page < viewPage ? 'above' : at.page > viewPage ? 'below' : 'here'
}
