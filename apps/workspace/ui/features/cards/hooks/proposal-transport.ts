'use client'

import { createContext, useContext } from 'react'
import { applyProposal, dismissProposal, getProposal } from '@/lib/proposals/client'
import type { ApplyProposalRequest, ProposalResponse } from '@/lib/proposals/types'

export interface ProposalTransport {
  get(id: string): Promise<ProposalResponse>
  apply(id: string, body?: ApplyProposalRequest): Promise<ProposalResponse>
  dismiss(id: string): Promise<ProposalResponse>
  readonly live: boolean
}

export const HTTP_PROPOSAL_TRANSPORT: ProposalTransport = {
  get: (id) => getProposal(id),
  apply: (id, body) => (body ? applyProposal(id, body) : applyProposal(id)),
  dismiss: (id) => dismissProposal(id),
  live: true,
}

const ProposalTransportContext = createContext<ProposalTransport>(HTTP_PROPOSAL_TRANSPORT)

export const ProposalTransportProvider = ProposalTransportContext.Provider

export function useProposalTransport(): ProposalTransport {
  return useContext(ProposalTransportContext)
}
