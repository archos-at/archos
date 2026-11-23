'use client'

import { useCallback } from 'react'
import { useRoomSelector, type DocumentRoom, type RoomPeerState } from './use-document-room'
import { peerSelections, selectionsKey } from '../lib/review-peer-state'

export function usePeerSelections(room: Pick<DocumentRoom, 'peers'>, selfUserId: string | null): Map<string, RoomPeerState[]> {
  const select = useCallback((peers: readonly RoomPeerState[]) => peerSelections(peers, selfUserId), [selfUserId])
  return useRoomSelector(room, select, (a, b) => selectionsKey(a) === selectionsKey(b))
}
