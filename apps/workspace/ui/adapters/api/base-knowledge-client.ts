/**
 * Base knowledge API client (ADR-0158): the office's standards, commentaries
 * and directives (`/api/base-knowledge`), and the office shelf documents one
 * can be recorded from. Same-origin BFF routes; the shapes are the service's
 * own wire types (`lib/base-knowledge/wire`). A non-OK answer throws
 * {@link ApiRequestError} with the HTTP status.
 */

import type {
  BaseKnowledgeEntry,
  BaseKnowledgeList,
  ConfirmEntryBody,
  LicenceEntryBody,
  RecordCheckBody,
} from '@/lib/base-knowledge/wire'
import { ApiRequestError } from './api-error'

export type { BaseKnowledgeEntry, BaseKnowledgeList }

const ENDPOINT = '/api/base-knowledge'
const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new ApiRequestError(`Failed to ${what}: ${response.status}`, response.status)
  return (await response.json()) as T
}

export const listBaseKnowledge = async (): Promise<BaseKnowledgeList> =>
  json(await fetch(`${ENDPOINT}?limit=200`), 'load base knowledge')

export const proposeBaseKnowledge = async (documentId: string): Promise<BaseKnowledgeEntry> =>
  json(
    await fetch(ENDPOINT, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ documentId }) }),
    'propose base knowledge',
  )

/** Upload a file as base knowledge: stored and proposed, its text held until confirmed. */
export const uploadBaseKnowledge = async (file: File): Promise<BaseKnowledgeEntry> => {
  const form = new FormData()
  form.append('file', file)
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

export const removeBaseKnowledge = async (entryId: string): Promise<void> => {
  await json(await fetch(`${ENDPOINT}/${encodeURIComponent(entryId)}`, { method: 'DELETE' }), 'remove base knowledge')
}

/** An office shelf document a person can record as base knowledge. */
export interface ShelfCandidate {
  id: string
  name: string
}

/** The office shelf's documents, whole shelf, newest first (one page of 200). */
export const listShelfCandidates = async (): Promise<ShelfCandidate[]> => {
  const body = await json<{ documents: { id: string; filename: string; displayName?: string | null }[] }>(
    await fetch('/api/documents?scope=office_shelf&limit=200'),
    'load the office shelf',
  )
  return body.documents.map((document) => ({ id: document.id, name: document.displayName ?? document.filename }))
}
