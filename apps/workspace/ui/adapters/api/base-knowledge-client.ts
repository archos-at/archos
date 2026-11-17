import type {
  BaseKnowledgeEntry,
  BaseKnowledgeFolder,
  BaseKnowledgeFolders,
  BaseKnowledgeList,
  BulkEntriesBody,
  BulkEntriesResult,
  ConfirmEntryBody,
  CreateFolderBody,
  LicenceEntryBody,
  ListEntriesQuery,
  RecordCheckBody,
  UpdateEntryBody,
} from '@/lib/base-knowledge/wire'
import { ApiRequestError } from './api-error'

export type { BaseKnowledgeEntry, BaseKnowledgeFolder, BaseKnowledgeFolders, BaseKnowledgeList, BulkEntriesResult }

const ENDPOINT = '/api/base-knowledge'
const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: unknown; error?: unknown } | null
    const said = problem?.detail ?? problem?.error
    const detail = typeof said === 'string' ? said : `Failed to ${what}: ${response.status}`
    throw new ApiRequestError(detail, response.status)
  }
  return (await response.json()) as T
}

export type EntryQuery = Partial<Pick<ListEntriesQuery, 'q' | 'kind' | 'attention' | 'folderId' | 'cursor' | 'limit'>>

export const listBaseKnowledge = async (query: EntryQuery = {}): Promise<BaseKnowledgeList> => {
  const params = new URLSearchParams({ limit: String(query.limit ?? 50) })
  for (const key of ['q', 'kind', 'attention', 'folderId', 'cursor'] as const) {
    const value = query[key]
    if (value) params.set(key, value)
  }
  return json(await fetch(`${ENDPOINT}?${params}`), 'load base knowledge')
}

export const getBaseKnowledgeEntry = async (entryId: string): Promise<BaseKnowledgeEntry> =>
  json(await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}`), 'load the entry')

export const renameBaseKnowledgeFolder = async (folderId: string, name: string): Promise<void> => {
  await json(
    await fetch(`/api/office-shelf/folders/${encodeURIComponent(folderId)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ name }) }),
    'rename the folder',
  )
}

export const deleteBaseKnowledgeFolder = async (folderId: string): Promise<void> => {
  await json(await fetch(`/api/office-shelf/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' }), 'delete the folder')
}

export const listBaseKnowledgeFolders = async (): Promise<BaseKnowledgeFolders> => {
  const first = await json<BaseKnowledgeFolders>(await fetch(`${ENDPOINT}/folders`), 'load base-knowledge folders')
  const folders = [...first.folders]
  for (let cursor = first.nextCursor; cursor; ) {
    const page = await json<BaseKnowledgeFolders>(
      await fetch(`${ENDPOINT}/folders?cursor=${encodeURIComponent(cursor)}`),
      'load base-knowledge folders',
    )
    folders.push(...page.folders)
    cursor = page.nextCursor
  }
  return { rootId: first.rootId, folders, nextCursor: null }
}

export const createBaseKnowledgeFolder = async (body: CreateFolderBody): Promise<BaseKnowledgeFolder> =>
  json(await fetch(`${ENDPOINT}/folders`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }), 'create a folder')

export const bulkBaseKnowledge = async (body: BulkEntriesBody): Promise<BulkEntriesResult> =>
  json(await fetch(`${ENDPOINT}/bulk`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }), 'change entries')

export const updateBaseKnowledge = async (entryId: string, body: UpdateEntryBody): Promise<BaseKnowledgeEntry> =>
  json(
    await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) }),
    'update base knowledge',
  )

export const addBaseKnowledgeEdition = async (entryId: string, file: File): Promise<BaseKnowledgeEntry> => {
  const form = new FormData()
  form.append('file', file)
  return json(await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}/editions`, { method: 'POST', body: form }), 'add an edition')
}

export const proposeBaseKnowledge = async (documentId: string): Promise<BaseKnowledgeEntry> =>
  json(
    await fetch(ENDPOINT, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ documentId }) }),
    'propose base knowledge',
  )

export const uploadBaseKnowledge = async (file: File, folderId: string | null = null): Promise<BaseKnowledgeEntry> => {
  const form = new FormData()
  form.append('file', file)
  if (folderId) form.append('folderId', folderId)
  return json(await fetch(`${ENDPOINT}/upload`, { method: 'POST', body: form }), 'upload base knowledge')
}

export const confirmBaseKnowledge = async (entryId: string, body: ConfirmEntryBody): Promise<BaseKnowledgeEntry> =>
  json(
    await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}/confirm`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
    'confirm base knowledge',
  )

export const setBaseKnowledgeLicence = async (entryId: string, body: LicenceEntryBody): Promise<BaseKnowledgeEntry> =>
  json(
    await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}/licence`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
    'set base knowledge licence',
  )

export const recordBaseKnowledgeCheck = async (entryId: string, body: RecordCheckBody): Promise<BaseKnowledgeEntry> =>
  json(
    await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}/checks`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
    'record a check',
  )

export interface BaseKnowledgeRemovalReceipt {
  removed: boolean
  stores: { search: 'removed' | 'failed' | 'none'; objects: 'removed' | 'partial'; caches: 'removed' | 'failed' }
}

export const removeBaseKnowledge = async (entryId: string): Promise<BaseKnowledgeRemovalReceipt> =>
  json(await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}`, { method: 'DELETE' }), 'remove base knowledge')

export interface ShelfCandidate {
  id: string
  name: string
}

export const listShelfCandidates = async (q = ''): Promise<ShelfCandidate[]> => {
  const query = new URLSearchParams({ scope: 'office_shelf', limit: '200' })
  if (q.trim()) query.set('q', q.trim())
  const body = await json<{ documents: { id: string; filename: string; displayName?: string | null }[] }>(
    await fetch(`/api/documents?${query.toString()}`),
    'load the office shelf',
  )
  return body.documents.map((document) => ({ id: document.id, name: document.displayName ?? document.filename }))
}
