'use client'

import type { ReactNode } from 'react'
import { answerCardSchema, type AnswerCard } from '@/shared/cards/schemas'
import type { ProposedChangeView } from '@/lib/proposals/types'
import type { CardRenderer } from '@/features/a2ui/catalog'
import { FileOperationReceipt, MemoryReceipt, OperationReceipt } from '@/features/cards/components/ProposalReceipts'

export interface ProposalTitles {
  files: (count: number) => string
  memory: string
}

export type DrawnProposal = { kind: 'card'; card: AnswerCard } | { kind: 'not-drawn' } | { kind: 'invalid' }

export function cardOfProposal(proposal: ProposedChangeView, titles: ProposalTitles): DrawnProposal {
  const raw = rawCardOf(proposal, titles)
  if (!raw) return { kind: 'not-drawn' }
  const parsed = answerCardSchema.safeParse(raw)
  return parsed.success ? { kind: 'card', card: parsed.data } : { kind: 'invalid' }
}

function rawCardOf(proposal: ProposedChangeView, titles: ProposalTitles): Record<string, unknown> | null {
  switch (proposal.kind) {
    case 'operation':
      return {
        type: 'operation_proposal',
        proposal_id: proposal.id,
        title: proposal.payload.summary,
        operation: proposal.payload.operation,
        input: proposal.payload.input,
      }
    case 'file_operation':
      return {
        type: 'file_operation_proposal',
        proposal_id: proposal.id,
        title: titles.files(proposal.payload.operations.length),
        operation: proposal.payload.operation,
        operations: proposal.payload.operations,
        note: proposal.payload.note ?? null,
      }
    case 'memory':
      return {
        type: 'memory_proposal',
        proposal_id: proposal.id,
        title: titles.memory,
        content: proposal.payload.content,
        kind: proposal.payload.kind,
        confidence: proposal.payload.confidence,
        supersedes: proposal.payload.supersedes ?? null,
      }
    case 'project_profile':
    case 'office_shelf_norm':
      return null
  }
}

export const renderProposalCard: CardRenderer = (card): ReactNode => {
  switch (card.type) {
    case 'operation_proposal':
      return <OperationReceipt proposalId={card.proposal_id} title={card.title} operation={card.operation} input={card.input ?? {}} />
    case 'file_operation_proposal':
      return card.proposal_id ? (
        <FileOperationReceipt
          proposalId={card.proposal_id}
          title={card.title}
          operation={card.operation}
          operations={card.operations}
          note={card.note}
        />
      ) : null
    case 'memory_proposal':
      return card.proposal_id ? (
        <MemoryReceipt
          proposalId={card.proposal_id}
          title={card.title}
          content={card.content}
          kind={card.kind}
          confidence={card.confidence}
          supersedes={card.supersedes}
        />
      ) : null
    default:
      return null
  }
}
