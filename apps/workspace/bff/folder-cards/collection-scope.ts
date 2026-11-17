import {
  computeFolderAccess,
  EVERY_FOLDER,
  isRestrictedCollectionOf,
  OPEN_ACCESS,
  restrictedCollectionBase,
  type AccessFolder,
} from '@/lib/authz/folder-access-rule'
import type { FolderCardKeyFact, FolderCardView, FolderDescriptionView } from './types'

export const FOLDER_CARDS_LIMIT = 1_000

export function projectCollectionCandidates(collection: string): string[] {
  const base = restrictedCollectionBase(collection)
  return base ? [collection, base] : [collection]
}

export function isCollectionOfProject(projectCollection: string, collection: string): boolean {
  return collection === projectCollection || isRestrictedCollectionOf(projectCollection, collection)
}

export function cardCollectionResolver(
  tree: readonly AccessFolder[],
  projectCollection: string,
): (folderId: string) => string {
  const access =
    tree.length > 0 ? computeFolderAccess(tree, EVERY_FOLDER, projectCollection) : OPEN_ACCESS(projectCollection)
  return (folderId) => access.collectionFor(folderId)
}

export interface StoredCard {
  abstract: string | null
  keyFacts: FolderCardKeyFact[]
  inputHash: string
  abstractHash: string | null
  model: string | null
  promptVersion: string | null
  status: FolderCardView['status']
  generatedAt: Date | string | null
  updatedAt: Date | string
}

export interface FolderWithCard {
  folderId: string
  folderPath: string
  folderDescription: string | null
  card: StoredCard | null
}

export function cardsInCollection(
  rows: readonly FolderWithCard[],
  collection: string,
  collectionOf: (folderId: string) => string,
): { cards: FolderCardView[]; folders: FolderDescriptionView[] } {
  const here = rows.filter((row) => collectionOf(row.folderId) === collection).slice(0, FOLDER_CARDS_LIMIT)
  const cards = here.flatMap((row) => (row.card ? [cardView(row, row.card, collection)] : []))
  const folders = here.map((row) => ({
    folder_id: row.folderId,
    folder_path: row.folderPath,
    folder_description: row.folderDescription,
  }))
  return { cards, folders }
}

function cardView(row: FolderWithCard, card: StoredCard, collection: string): FolderCardView {
  return {
    folder_id: row.folderId,
    folder_path: row.folderPath,
    folder_description: row.folderDescription,
    collection,
    abstract: card.abstract,
    key_facts: card.keyFacts,
    input_hash: card.inputHash,
    abstract_hash: card.abstractHash,
    model: card.model,
    prompt_version: card.promptVersion,
    status: card.status,
    generated_at: card.generatedAt ? new Date(card.generatedAt).toISOString() : null,
    updated_at: new Date(card.updatedAt).toISOString(),
  }
}
