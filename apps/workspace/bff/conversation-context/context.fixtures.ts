import type { ConversationScope } from './resolve'
import type { ContextKind, ConversationContext } from './types'
import type { ScopedCollection } from '@/lib/retrieval-scope/collection-scope'

export function closedContext(kind: ContextKind, conversationId: string | null): ConversationContext {
  return {
    kind,
    conversationId,
    audience: {
      row: { exists: false, projectId: null, createdBy: null, visibility: 'private', grantees: [], version: null },
      solo: false,
      version: null,
    },
    projectId: null,
    may: {
      shelves: [],
      restrictedCollections: [],
      otherProjects: { reach: 'none', restrictedFolders: false },
      personalMemory: false,
      personalShelf: false,
      projectMemory: { readableFolderIds: [] },
      workspaceRead: 'none',
      features: { deepResearch: false, tasks: false },
    },
    recorded: { folders: [], projects: [], personalShelf: false },
  }
}

export function scopeWith(shelves: ScopedCollection[], projectId: string | null): ConversationScope {
  const closed = closedContext('chat', null)
  return {
    kind: 'chat',
    conversationId: null,
    audience: closed.audience,
    projectId,
    projectCollectionName: null,
    shelves,
    restrictedCollections: [],
  }
}
