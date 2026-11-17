'use client'

import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useCardDecision } from '../hooks/use-card-decision'
import type { FileOperationItem, FileOperationKind } from '../lib/file-operations'
import { OperationList } from './FileOperationRows'
import { ProposalShell } from './ProposalShell'
import { FileOperationReceipt } from './ProposalReceipts'

interface FileOperationProposalCardProps {
  title: string
  operation: FileOperationKind
  operations: FileOperationItem[]
  note?: string | null
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
  proposalId?: string | null
}

export function FileOperationProposalCard({ proposalId, ...props }: FileOperationProposalCardProps) {
  return proposalId ? (
    <FileOperationReceipt
      proposalId={proposalId}
      title={props.title}
      operation={props.operation}
      operations={props.operations}
      note={props.note}
    />
  ) : (
    <UnstoredProposalCard {...props} />
  )
}

function UnstoredProposalCard({
  title,
  operation,
  operations,
  note,
  messageId,
  cardKey,
  decisionsMustPersist,
}: Omit<FileOperationProposalCardProps, 'proposalId'>) {
  const t = useTranslations(chatCopy)
  const { decision } = useCardDecision(messageId, cardKey, { mustPersist: decisionsMustPersist })

  if (decision === 'accepted' || decision === 'partiallyApplied') {
    return (
      <ProposalShell tone="accepted">
        <p className="text-foreground text-sm">
          {decision === 'accepted'
            ? t(`cards.fileOperationProposal.applied.${operation}`, { count: operations.length })
            : t('cards.fileOperationProposal.partial')}
        </p>
      </ProposalShell>
    )
  }

  if (decision === 'rejected') {
    return (
      <ProposalShell tone="dismissed">
        <p className="text-muted-foreground text-sm">{t('cards.fileOperationProposal.dismissed')}</p>
      </ProposalShell>
    )
  }

  return (
    <ProposalShell tone="pending">
      <SectionLabel>{t(`cards.fileOperationProposal.eyebrow.${operation}`)}</SectionLabel>

      <p className="text-foreground text-sm font-medium">{title}</p>

      <OperationList operation={operation} items={operations} />

      {note && <p className="card-caption text-muted-foreground">{note}</p>}

      <p className="card-caption text-muted-foreground" data-testid="file-operation-unavailable">
        {t('cards.fileOperationProposal.notStored')}
      </p>
    </ProposalShell>
  )
}
