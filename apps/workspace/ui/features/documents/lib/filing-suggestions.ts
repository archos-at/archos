import type { FilingBasis, ListedProposal } from '@/lib/proposals/types'

export interface FilingSuggestionView {
  proposalId: string
  folder: string
  reason: string | null
  isNew: boolean
  basis: FilingBasis
  fileCount: number
  canDecide: boolean
  shelf: 'project' | 'office'
  documentIds: readonly string[]
}

function filingFolderOf(proposal: ListedProposal['proposal']): { folder: string; basis: FilingBasis } | null {
  if (proposal.kind !== 'file_operation' || proposal.status !== 'proposed') return null
  const { payload } = proposal
  if (!payload.basis || proposal.originConversationId !== null || payload.operation !== 'move') return null
  const folder = payload.operations[0]?.target_folder ?? ''
  return folder ? { folder, basis: payload.basis } : null
}

function viewFor({ proposal, documents }: ListedProposal, documentName: string | undefined): FilingSuggestionView | null {
  const filing = filingFolderOf(proposal)
  if (!filing || proposal.kind !== 'file_operation') return null
  const { payload } = proposal
  const item = payload.operations.find((entry) => entry.document === documentName)
  return {
    proposalId: proposal.id,
    folder: filing.folder,
    reason: item?.reason ?? null,
    isNew: Boolean(payload.new_folder),
    basis: filing.basis,
    fileCount: payload.operations.length,
    canDecide: proposal.canDecide,
    shelf: payload.operations[0]?.source === 'office' ? 'office' : 'project',
    documentIds: documents.map((document) => document.id),
  }
}

export function suggestionsByDocument(listed: readonly ListedProposal[]): Map<string, FilingSuggestionView> {
  const byDocument = new Map<string, FilingSuggestionView>()
  for (const entry of listed) {
    for (const document of entry.documents) {
      if (byDocument.has(document.id)) continue
      const view = viewFor(entry, document.name)
      if (view) byDocument.set(document.id, view)
    }
  }
  return byDocument
}

export interface FilingFolderSuggestion {
  suggestion: FilingSuggestionView
  documents: readonly { id: string; name: string }[]
}

export function suggestionsByFolder(listed: readonly ListedProposal[]): FilingFolderSuggestion[] {
  return listed.flatMap((entry) => {
    if (entry.documents.length === 0) return []
    const suggestion = viewFor(entry, entry.documents[0].name)
    return suggestion ? [{ suggestion, documents: entry.documents }] : []
  })
}

export function filingBarEntries(
  byFolder: readonly FilingFolderSuggestion[],
  documentIds: Iterable<string>,
  minFiles: number
): FilingFolderSuggestion[] {
  const inView = new Set(documentIds)
  const entries = byFolder.filter((entry) => entry.documents.some((document) => inView.has(document.id)))
  return entries.some((entry) => entry.suggestion.fileCount >= minFiles) ? entries : []
}
