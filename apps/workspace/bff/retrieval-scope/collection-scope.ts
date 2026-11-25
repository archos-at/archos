import type { UserSession } from '@/lib/auth/types'

export const COLLECTION_SHELVES = ['office_shelf', 'project', 'session', 'base', 'personal'] as const

export type CollectionShelf = (typeof COLLECTION_SHELVES)[number]

export interface ScopedCollection {
  collection: string
  shelf?: CollectionShelf
  countries?: string[]
}

export function sessionCollectionName(conversationId: string): string {
  return conversationId.startsWith('s_') ? conversationId : `s_${conversationId}`
}

export interface ScopeContext {
  projectId?: string
  projectCollectionName?: string
  includeProject?: boolean
  conversationId?: string
  baseCollection?: string
  officeShelfCollectionName?: string
  restrictedCollections?: readonly string[]
}

export const BASE_CORPUS_COLLECTION = 'base_corpus'
// drop after release 2027-W02
export const LEGACY_BASE_CORPUS_COLLECTION = 'oib_knowledge'

export function isBaseCorpusCollection(name: string): boolean {
  return name === BASE_CORPUS_COLLECTION || name === LEGACY_BASE_CORPUS_COLLECTION
}

export function resolveBaseCollectionName(): string {
  return BASE_CORPUS_COLLECTION
}

export function computeCollectionScope(
  _session: UserSession | null,
  context: ScopeContext,
): string[] {
  const scope: string[] = []
  const base = context.baseCollection || resolveBaseCollectionName()
  scope.push(base)

  if (context.officeShelfCollectionName) {
    scope.push(context.officeShelfCollectionName)
  }

  if (context.includeProject !== false) {
    const projectCollectionName = context.projectCollectionName || (context.projectId ? `proj_${context.projectId}` : undefined)
    if (projectCollectionName) {
      scope.push(projectCollectionName)
      scope.push(...(context.restrictedCollections ?? []))
    }
  }

  if (context.conversationId) {
    scope.push(sessionCollectionName(context.conversationId))
  }

  return [...new Set(scope)]
}

export function buildCollectionScopeHeader(scope: string[]): string {
  return Buffer.from(JSON.stringify(scope)).toString('base64url')
}

export function encodeCollectionScopeHeader(collections: ScopedCollection[]): string {
  return Buffer.from(JSON.stringify(collections)).toString('base64url')
}
