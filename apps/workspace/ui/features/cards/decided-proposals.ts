import { create } from 'zustand'
import type { ProposedChangeView } from '@/lib/proposals/types'

export type DecidedProposals = Readonly<Record<string, ProposedChangeView>>

interface DecidedProposalsState {
  byId: DecidedProposals
  record: (proposal: ProposedChangeView) => void
}

export const useDecidedProposals = create<DecidedProposalsState>()((set) => ({
  byId: {},
  record: (proposal) => {
    if (proposal.status === 'proposed') return
    set((state) => (state.byId[proposal.id] === proposal ? state : { byId: { ...state.byId, [proposal.id]: proposal } }))
  },
}))

export const resetDecidedProposals = (): void => useDecidedProposals.setState({ byId: {} })
