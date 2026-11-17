import { vi } from 'vitest'
import type * as FolderAccess from '@/lib/authz/folder-access'
import * as rule from '@/lib/authz/folder-access-rule'

type FolderAccessModule = Pick<
  typeof FolderAccess,
  | 'getHiddenFolderIds'
  | 'getRestrictedFolderIds'
  | 'isFolderVisibleTo'
  | 'isFolderVisibleToClearance'
  | 'filterUsersWhoMayReadFolder'
  | 'filterUsersWhoMayWriteFolder'
  | 'isFolderVisibleToMember'
  | 'loadCustomFolderTree'
  | 'placementCollectionFor'
  | 'getProjectFolderAccess'
  | 'currentRestrictedCollections'
  | 'clearanceOfMember'
  | 'requireFolderWrite'
  | 'canWriteFolder'
  | 'projectMayWriteDocuments'
  | 'readableFolderIdsFor'
  | 'sourceFoldersOfCollections'
  | 'customFolderNames'
>

export function openFolderAccess(projectCollection: string): FolderAccess.ProjectFolderAccess {
  return {
    hiddenFolderIds: new Set<string>(),
    isVisible: () => true,
    levelOf: () => 'write',
    collectionFor: () => projectCollection,
    sourceFolderOf: () => null,
    clearedRestrictedCollections: [],
    anyRestricted: false,
  }
}

export function openFolderAccessModule(): FolderAccessModule & typeof rule {
  return {
    ...rule,
    getHiddenFolderIds: vi.fn(async () => []),
    getRestrictedFolderIds: vi.fn(async () => []),
    isFolderVisibleTo: vi.fn(async () => true),
    isFolderVisibleToClearance: vi.fn(async () => true),
    filterUsersWhoMayReadFolder: vi.fn(
      async (_org: string, _project: string, _folder: string | null, userIds: readonly string[]) => new Set(userIds)
    ),
    filterUsersWhoMayWriteFolder: vi.fn(
      async (_org: string, _project: string, _folder: string | null, userIds: readonly string[]) => new Set(userIds)
    ),
    isFolderVisibleToMember: vi.fn(async () => true),
    loadCustomFolderTree: vi.fn(async () => null),
    placementCollectionFor: vi.fn(async (_org: string, _project: string, collection: string) => collection),
    getProjectFolderAccess: vi.fn(async (_session, _project: string, collection: string) => openFolderAccess(collection)),
    currentRestrictedCollections: vi.fn(async () => []),
    clearanceOfMember: vi.fn(async () => ({ levels: {}, seesEverything: false })),
    requireFolderWrite: vi.fn(async () => undefined),
    canWriteFolder: vi.fn(async () => true),
    projectMayWriteDocuments: vi.fn(async () => true),
    readableFolderIdsFor: vi.fn(async () => []),
    sourceFoldersOfCollections: vi.fn(async () => new Map<string, string>()),
    customFolderNames: vi.fn(async () => new Map<string, string>()),
  }
}
