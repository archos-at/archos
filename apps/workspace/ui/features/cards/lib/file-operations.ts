import type { AnswerCard } from '@/shared/cards/schemas'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'

type ProposalCard = Extract<AnswerCard, { type: 'file_operation_proposal' }>
export type FileOperationKind = ProposalCard['operation']
export type FileOperationItem = Partial<ProposalCard['operations'][number]>

export interface FileOperationNewFolder {
  path: string
  description?: string | null
}

export interface FileOperationResult {
  label: string
  ok: boolean
  reason?: string
}

export function operationLabel(operation: FileOperationKind, item: FileOperationItem): string {
  if (operation === 'create_folder') {
    return item.parent_folder ? `${item.parent_folder}/${item.folder_name}` : (item.folder_name ?? '')
  }
  return item.document ?? ''
}

export function notifyIfAnyApplied(results: readonly Pick<FileOperationResult, 'ok'>[] | null | undefined): void {
  if (results?.some((result) => result.ok)) notifyDocumentsChanged()
}
