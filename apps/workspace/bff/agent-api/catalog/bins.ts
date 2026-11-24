import { z } from 'zod'
import { binListQuerySchema } from '@/lib/projects/folder-bin-wire'
import type { AgentOperation } from '../operation'

const projectParams = z.object({ id: z.string().describe('The project id, from project-list.') })
const folderParams = projectParams.extend({
  folderId: z.string().describe('The folder id, from project-folder-list or project-folder-bin-list.'),
})
const officeBinParams = z.object({
  folderId: z.string().describe('The deleted office shelf folder id, from office-shelf-folder-bin-list.'),
})

export const binOperations = [
  {
    name: 'project-folder-bin-list',
    domain: 'folders',
    summary: 'List a project’s bin: deleted folders and documents',
    description:
      "The project's bin, newest first, paged (`nextCursor`): deleted folders, who deleted each, when it is purged. An entry " +
      'with `document` is one document: restore it with document-restore; a folder with project-folder-restore.',
    method: 'GET',
    path: '/api/projects/[id]/bin',
    params: projectParams,
    query: binListQuerySchema,
    load: () => import('@/app/api/projects/[id]/bin/route'),
  },
  {
    name: 'project-folder-restore',
    domain: 'folders',
    summary: 'Restore a folder from the bin',
    description:
      'Brings a deleted folder back with its access, subfolders and documents. The response says ' +
      "`restoredTo: 'root'` when its former parent no longer exists. Folder ids come from " +
      'project-folder-bin-list.',
    method: 'POST',
    path: '/api/projects/[id]/bin/[folderId]/restore',
    params: folderParams,
    load: () => import('@/app/api/projects/[id]/bin/[folderId]/restore/route'),
  },
  {
    name: 'project-folder-bin-purge',
    domain: 'folders',
    summary: 'Purge a folder from the bin now',
    description:
      'Deletes a binned folder for good, with its subfolders and documents, instead of waiting for the ' +
      'grace period. This cannot be undone. Needs project:manage; a legal hold refuses it with 409 ' +
      'without naming the hold. Folder ids come from project-folder-bin-list.',
    method: 'DELETE',
    path: '/api/projects/[id]/bin/[folderId]',
    params: folderParams,
    destructive: true,
    load: () => import('@/app/api/projects/[id]/bin/[folderId]/route'),
  },
  {
    name: 'office-shelf-folder-bin-list',
    domain: 'folders',
    summary: 'List the office shelf’s bin: deleted folders and documents',
    description:
      "The office shelf's bin, newest first, paged (`nextCursor`): deleted folders, who deleted each, when it is purged. " +
      'An entry with `document` is one document: restore it with document-restore; a folder with ' +
      'office-shelf-folder-restore. Any member may read.',
    method: 'GET',
    path: '/api/office-shelf/bin',
    query: binListQuerySchema,
    load: () => import('@/app/api/office-shelf/bin/route'),
  },
  {
    name: 'office-shelf-folder-restore',
    domain: 'folders',
    summary: 'Restore an office shelf folder from the bin',
    description:
      'Brings a deleted office shelf folder back with its subfolders and documents, which are read again. The response ' +
      "says `restoredTo: 'root'` when its former parent no longer exists. Folder ids come from " +
      'office-shelf-folder-bin-list. Needs org:office_shelf:manage.',
    method: 'POST',
    path: '/api/office-shelf/bin/[folderId]/restore',
    params: officeBinParams,
    load: () => import('@/app/api/office-shelf/bin/[folderId]/restore/route'),
  },
  {
    name: 'office-shelf-folder-bin-purge',
    domain: 'folders',
    summary: 'Purge an office shelf folder from the bin now',
    description:
      'Deletes a binned office shelf folder for good, with its subfolders and documents, instead of waiting for the ' +
      'grace period. This cannot be undone. Needs org:office_shelf:manage; a legal hold refuses it with 409 without ' +
      'naming the hold. Folder ids come from office-shelf-folder-bin-list.',
    method: 'DELETE',
    path: '/api/office-shelf/bin/[folderId]',
    params: officeBinParams,
    destructive: true,
    load: () => import('@/app/api/office-shelf/bin/[folderId]/route'),
  },
] as const satisfies readonly AgentOperation[]
