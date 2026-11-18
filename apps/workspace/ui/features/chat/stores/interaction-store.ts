import type { StateCreator } from 'zustand'
import type { ChatStore, PendingInteraction } from '../types'

export type InteractionSlice = {
  pendingInteraction: PendingInteraction | null
  respondToInteractionFn: ((response: string) => void) | null
  setRespondToInteractionFn: (fn: ((response: string) => void) | null) => void
}

export const initialInteractionState = {
  pendingInteraction: null as PendingInteraction | null,
  respondToInteractionFn: null as ((response: string) => void) | null,
}

export const createInteractionSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  InteractionSlice
> = (set) => ({
  ...initialInteractionState,

  setRespondToInteractionFn: (fn) => {
    set({ respondToInteractionFn: fn }, false, 'setRespondToInteractionFn')
  },
})
