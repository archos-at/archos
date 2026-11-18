'use client'

import { sameValue } from '@/lib/utils/same-value'
import { roomCompanyOf, type RoomCompany } from '../lib/review-peers'
import { useRoomSelector, type DocumentRoom } from './use-document-room'

export const useRoomCompany = (room: Pick<DocumentRoom, 'peers'>): RoomCompany =>
  useRoomSelector(room, roomCompanyOf, sameValue)
