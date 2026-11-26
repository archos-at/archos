import { folderPathKey } from '@/lib/projects/folders'
import { MAX_FILE_OPERATION_ITEMS, type FileOperationPayload, type FilingBasis } from '@/lib/proposals/types'
import type { FilingMove } from './types'

export const documentNameKey = (name: string): string => name.normalize('NFC').trim().toLowerCase()

export interface RecordedProposal {
  id: string
  status: 'proposed' | 'dismissed' | string
  payload: FileOperationPayload
  originConversationId: string | null
  claimed: boolean
}

export interface PlannedDocument {
  id: string
  filename: string
}

export interface FilingPlanInput {
  basis: FilingBasis
  shelf: 'project' | 'office_shelf'
  documents: readonly PlannedDocument[]
  batch: readonly PlannedDocument[]
  judged: boolean
  moves: readonly FilingMove[]
  restrictedDocumentIds: ReadonlySet<string>
  restrictedPaths: readonly string[]
  record: readonly RecordedProposal[]
}

export interface FilingPlan {
  create: FileOperationPayload[]
  withdraw: string[]
}

type ProposedItem = FileOperationPayload['operations'][number]

const itemKey = (item: ProposedItem): string | null => {
  if (item.document_id) return `id:${item.document_id}`
  const name = documentNameKey(item.document ?? '')
  return name ? `name:${name}` : null
}

const documentKeys = (document: PlannedDocument): string[] => [`id:${document.id}`, `name:${documentNameKey(document.filename)}`]

const pairKey = (key: string, path: string) => `${key}\u0000${folderPathKey(path)}`

const isFilingSuggestion = (proposal: RecordedProposal) =>
  proposal.originConversationId === null && Boolean(proposal.payload.basis) && proposal.payload.operation === 'move'

function underRestricted(path: string, restrictedPaths: readonly string[]): boolean {
  const key = folderPathKey(path)
  return restrictedPaths.some((restricted) => {
    const root = folderPathKey(restricted)
    return root.length > 0 && (key === root || key.startsWith(`${root}/`))
  })
}

function batchDocumentOf(item: ProposedItem, batch: readonly PlannedDocument[]): PlannedDocument | null {
  if (item.document_id) return batch.find((document) => document.id === item.document_id) ?? null
  const name = documentNameKey(item.document ?? '')
  const named = name ? batch.filter((document) => documentNameKey(document.filename) === name) : []
  return named.length === 1 ? named[0] : null
}

function revise(input: FilingPlanInput, moveById: ReadonlyMap<string, FilingMove>) {
  const withdraw: string[] = []
  const covered = new Set<string>()
  for (const proposal of input.record) {
    if (proposal.status !== 'proposed') continue
    const items = proposal.payload.operations
    const ours = items.filter((item) => batchDocumentOf(item, input.batch) !== null)
    const revisable = input.basis === 'content' && input.judged && isFilingSuggestion(proposal) && !proposal.claimed
    const supported = ours.every((item) => {
      const document = batchDocumentOf(item, input.batch)
      const move = document ? moveById.get(document.id) : undefined
      return move !== undefined && folderPathKey(move.folder) === folderPathKey(item.target_folder)
    })
    if (ours.length > 0 && revisable && !supported) {
      withdraw.push(proposal.id)
      continue
    }
    for (const item of items) {
      const key = itemKey(item)
      if (key) covered.add(key)
    }
  }
  return { withdraw, covered }
}

function proposalsFor(moves: ReadonlyArray<{ move: FilingMove; document: PlannedDocument }>, input: FilingPlanInput) {
  const byTarget = new Map<string, Array<{ move: FilingMove; document: PlannedDocument }>>()
  for (const entry of moves) {
    const key = folderPathKey(entry.move.folder)
    byTarget.set(key, [...(byTarget.get(key) ?? []), entry])
  }
  const create: FileOperationPayload[] = []
  for (const entries of byTarget.values()) {
    for (let start = 0; start < entries.length; start += MAX_FILE_OPERATION_ITEMS) {
      const chunk = entries.slice(start, start + MAX_FILE_OPERATION_ITEMS)
      const { folder, newFolder } = chunk[0].move
      create.push({
        operation: 'move',
        operations: chunk.map(({ move, document }) => ({
          document: document.filename,
          document_id: document.id,
          source: input.shelf === 'office_shelf' ? 'office' : 'project',
          target_folder: folder,
          reason: move.reason,
        })),
        basis: input.basis,
        new_folder: newFolder ? { path: folder, description: newFolder.description } : null,
      })
    }
  }
  return create
}

export function planFiling(input: FilingPlanInput): FilingPlan {
  if (!input.judged) return { create: [], withdraw: [] }
  const byId = new Map(input.documents.map((document) => [document.id, document]))
  const moveById = new Map(input.moves.filter((move) => byId.has(move.documentId)).map((move) => [move.documentId, move]))
  const { withdraw, covered } = revise(input, moveById)
  const dismissed = new Set(
    input.record
      .filter((proposal) => proposal.status === 'dismissed' && proposal.payload.operation === 'move')
      .flatMap((proposal) =>
        proposal.payload.operations.flatMap((item) => {
          const key = itemKey(item)
          return key ? [pairKey(key, item.target_folder ?? '')] : []
        })
      )
  )
  const surviving = input.moves.flatMap((move) => {
    const document = byId.get(move.documentId)
    if (!document) return []
    if (input.restrictedDocumentIds.has(document.id)) return []
    if (underRestricted(move.folder, input.restrictedPaths)) return []
    const keys = documentKeys(document)
    if (keys.some((key) => covered.has(key))) return []
    if (keys.some((key) => dismissed.has(pairKey(key, move.folder)))) return []
    return [{ move, document }]
  })
  return { create: proposalsFor(surviving, input), withdraw }
}
