import type { KnowledgeBaseStatus } from '@/lib/knowledge/service'
import { ApiRequestError } from './api-error'

export type { KnowledgeBaseStatus }

export interface LoadedDocument {
  url: string
  title: string
  text: string
  truncated: boolean
}

const KNOWLEDGE_BASE_PATH = '/api/knowledge-base'
const RIS_DOCUMENT_PATH = '/api/ris/document'

const failure = (context: string, status: number): ApiRequestError =>
  new ApiRequestError(`${context}: ${status}`, status)

export const getKnowledgeBase = async (): Promise<KnowledgeBaseStatus> => {
  const response = await fetch(KNOWLEDGE_BASE_PATH)
  if (!response.ok) throw failure('Failed to load knowledge base', response.status)
  return (await response.json()) as KnowledgeBaseStatus
}

export const getRisDocument = async (reference: string, passage?: string): Promise<LoadedDocument> => {
  const query = new URLSearchParams({ reference })
  if (passage) query.set('passage', passage)
  const response = await fetch(`${RIS_DOCUMENT_PATH}?${query.toString()}`)
  if (!response.ok) throw failure('Failed to load legal document', response.status)
  return (await response.json()) as LoadedDocument
}
