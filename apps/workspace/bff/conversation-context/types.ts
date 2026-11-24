import type { ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import type { ResourceVisibility } from '@/lib/db/schema/resource-shares'
import type { ScopedCollection } from '@/lib/retrieval-scope/collection-scope'

export const CONTEXT_KINDS = ['chat', 'run', 'headless', 'external'] as const

export type ContextKind = (typeof CONTEXT_KINDS)[number]

export const WORKSPACE_READS = ['none', 'document+projectFacts', 'all'] as const

export type WorkspaceRead = (typeof WORKSPACE_READS)[number]

export const OTHER_PROJECT_REACHES = ['none', 'every-reader', 'chat-projects'] as const

export type OtherProjectReach = (typeof OTHER_PROJECT_REACHES)[number]

export interface ContextAudience {
  row: ConversationAudienceRow
  solo: boolean
  version: number | null
}

export interface ContextMay {
  shelves: ScopedCollection[]
  restrictedCollections: string[]
  otherProjects: { reach: OtherProjectReach; restrictedFolders: boolean }
  personalMemory: boolean
  personalShelf: boolean
  projectMemory: { readableFolderIds: string[] }
  workspaceRead: WorkspaceRead
  features: { deepResearch: boolean; tasks: boolean }
}

export interface ContextRecorded {
  folders: string[]
  projects: string[]
  personalShelf: boolean
}

export interface ConversationContext {
  kind: ContextKind
  conversationId: string | null
  audience: ContextAudience
  projectId: string | null
  may: ContextMay
  recorded: ContextRecorded
}

export function opensBeyond(visibility: ResourceVisibility, otherReaders: number): boolean {
  return visibility !== 'private' || otherReaders > 0
}

export function isSoloAudience(audience: ConversationAudienceRow, userId: string): boolean {
  if (!audience.exists) return true
  if (audience.createdBy !== userId) return false
  return !opensBeyond(audience.visibility, audience.grantees.filter((grantee) => grantee !== userId).length)
}

export function mayPersonalMemory(kind: ContextKind, conversationId: string | null, solo: boolean): boolean {
  return solo && conversationId !== null && (kind === 'chat' || kind === 'run')
}

export function mayPersonalShelf(personalMemory: boolean, projectId: string | null): boolean {
  return personalMemory && projectId === null
}

export function workspaceReadOf(kind: ContextKind, conversationId: string | null, solo: boolean): WorkspaceRead {
  if (kind === 'headless') return 'none'
  if (kind === 'external' || conversationId === null || solo) return 'all'
  return 'document+projectFacts'
}

export function otherProjectsOf(
  kind: ContextKind,
  conversationId: string | null,
  solo: boolean,
): ContextMay['otherProjects'] {
  if (kind === 'headless' || (kind === 'run' && conversationId === null)) return { reach: 'none', restrictedFolders: false }
  if (kind === 'external' || conversationId === null || solo) return { reach: 'chat-projects', restrictedFolders: true }
  return { reach: 'every-reader', restrictedFolders: false }
}

export function isConfined(may: Pick<ContextMay, 'restrictedCollections'>, recorded: ContextRecorded): boolean {
  return may.restrictedCollections.length > 0 || recorded.folders.length > 0 || recorded.projects.length > 0
}

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
