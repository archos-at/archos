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
  batchFilenames: readonly string[]
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

const pairKey = (filename: string, path: string) => `${documentNameKey(filename)}\u0000${folderPathKey(path)}`

const isFilingSuggestion = (proposal: RecordedProposal) =>
  proposal.originConversationId === null && Boolean(proposal.payload.basis) && proposal.payload.operation === 'move'

function underRestricted(path: string, restrictedPaths: readonly string[]): boolean {
  const key = folderPathKey(path)
  return restrictedPaths.some((restricted) => {
    const root = folderPathKey(restricted)
    return root.length > 0 && (key === root || key.startsWith(`${root}/`))
  })
}

function revise(input: FilingPlanInput, moveByName: ReadonlyMap<string, FilingMove>) {
  const batch = new Set(input.batchFilenames.map(documentNameKey))
  const withdraw: string[] = []
  const covered = new Set<string>()
  for (const proposal of input.record) {
    if (proposal.status !== 'proposed') continue
    const names = proposal.payload.operations.map((item) => documentNameKey(item.document ?? '')).filter(Boolean)
    const ours = names.filter((name) => batch.has(name))
    const revisable = input.basis === 'content' && input.judged && isFilingSuggestion(proposal) && !proposal.claimed
    const supported = proposal.payload.operations.every((item) => {
      const name = documentNameKey(item.document ?? '')
      if (!batch.has(name)) return true
      const move = moveByName.get(name)
      return move !== undefined && folderPathKey(move.folder) === folderPathKey(item.target_folder)
    })
    if (ours.length > 0 && revisable && !supported) {
      withdraw.push(proposal.id)
      continue
    }
    for (const name of names) covered.add(name)
  }
  return { withdraw, covered }
}

function proposalsFor(moves: ReadonlyArray<{ move: FilingMove; filename: string }>, input: FilingPlanInput) {
  const byTarget = new Map<string, Array<{ move: FilingMove; filename: string }>>()
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
        operations: chunk.map(({ move, filename }) => ({
          document: filename,
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
  const moveByName = new Map<string, FilingMove>()
  for (const move of input.moves) {
    const document = byId.get(move.documentId)
    if (document) moveByName.set(documentNameKey(document.filename), move)
  }
  const { withdraw, covered } = revise(input, moveByName)
  const dismissed = new Set(
    input.record
      .filter((proposal) => proposal.status === 'dismissed' && proposal.payload.operation === 'move')
      .flatMap((proposal) =>
        proposal.payload.operations.map((item) => pairKey(item.document ?? '', item.target_folder ?? ''))
      )
  )
  const surviving = input.moves.flatMap((move) => {
    const document = byId.get(move.documentId)
    if (!document) return []
    if (input.restrictedDocumentIds.has(document.id)) return []
    if (underRestricted(move.folder, input.restrictedPaths)) return []
    if (covered.has(documentNameKey(document.filename))) return []
    if (dismissed.has(pairKey(document.filename, move.folder))) return []
    return [{ move, filename: document.filename }]
  })
  return { create: proposalsFor(surviving, input), withdraw }
}
