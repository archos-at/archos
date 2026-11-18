import type { AuditAction } from './service'

export const DOCUMENT_NAME_ACTIONS = [
  'document.uploaded',
  'document.screening_overridden',
  'document.quarantined',
  'document.quarantine_released',
  'document.deleted',
  'document.archived',
  'document.unarchived',
  'document.generated',
  'document.renamed',
] as const satisfies readonly AuditAction[]
export type DocumentNameAction = (typeof DOCUMENT_NAME_ACTIONS)[number]

export const UNRESTRICTED_NAME_ACTIONS: Partial<Record<AuditAction, string>> = {
  'org.created': 'an organization name; nothing above a folder is restricted',
  'project.created': 'a project name; projects are not folder-restricted',
  'project.deleted': 'a project name; projects are not folder-restricted',
  'project.closed': 'a project name; projects are not folder-restricted',
  'project.reopened': 'a project name; projects are not folder-restricted',
  'project.paused': 'a project name; projects are not folder-restricted',
  'project.resumed': 'a project name; projects are not folder-restricted',
  'office_shelf.document.uploaded': 'the Büroablage has no per-role folder access',
  'office_shelf.document.deleted': 'the Büroablage has no per-role folder access',
  'office_shelf.document.renamed': 'the Büroablage has no per-role folder access',
  'archiv.document.uploaded': 'the Büroablage has no per-role folder access',
  'archiv.document.deleted': 'the Büroablage has no per-role folder access',
  'archiv.document.renamed': 'the Büroablage has no per-role folder access',
  'session.document.uploaded': 'a chat attachment is filed in no folder',
  'session.document.deleted': 'a chat attachment is filed in no folder',
  'download_log.viewed':
    'sends nameFiltered, never the typed text; documentName stays registered only for a previous release mid-rollout',
}

export const DOCUMENT_NAME_KEYS = ['filename', 'previousName', 'displayName', 'terms'] as const

export type AuditDocumentPlacement = { projectId: string; folderId: string | null } | null

export function filedInOf(document: { projectId: string | null; folderId: string | null }): AuditDocumentPlacement {
  return document.projectId === null ? null : { projectId: document.projectId, folderId: document.folderId }
}
