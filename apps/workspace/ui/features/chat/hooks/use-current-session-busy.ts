'use client'

import { useChatStore } from '../store'

export const useIsCurrentSessionBusy = (): boolean => {
  const isStreaming = useChatStore((state) => state.isStreaming)
  const hasPendingInteraction = useChatStore((state) => state.pendingInteraction !== null)
  return isStreaming || hasPendingInteraction
}
