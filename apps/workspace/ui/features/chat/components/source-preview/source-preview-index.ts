import { onDocumentsChanged } from '@/lib/documents/document-changes'
import {
  resetDocumentsByNameCache,
  resolveDocumentsByName,
} from '@/features/documents/lib/documents-by-name'
import type { RevisionRef } from '@/lib/documents/revision-links'
import type { StoredDocumentRef } from '../../lib/citations'
import type { Shelf } from '@/lib/source-kinds'

export interface SourcePreviewIndex {
  storedDocuments: StoredDocumentRef[]
  baseCorpusFiles: string[]
}

interface ShelfLists {
  sessionDocuments: StoredDocumentRef[]
  baseCorpusFiles: string[]
}

const indexCache = new Map<string, Promise<ShelfLists>>()

export const resetSourcePreviewIndexCache = (): void => {
  indexCache.clear()
  resetDocumentsByNameCache()
}

onDocumentsChanged(resetSourcePreviewIndexCache)

interface ListedRow {
  id: string
  filename: string
  contentType?: string | null
  revision?: { supersededBy?: RevisionRef | null } | null
}

const toRefs = (rows: unknown, shelf: Shelf): StoredDocumentRef[] =>
  Array.isArray(rows)
    ? rows
        .filter(
          (doc): doc is ListedRow =>
            !!doc && typeof doc.id === 'string' && typeof doc.filename === 'string'
        )
        .map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          contentType: doc.contentType ?? null,
          shelf,
          supersededBy: doc.revision?.supersededBy ?? null,
        }))
    : []

export const loadSourcePreviewIndex = async (
  projectId: string | null,
  conversationId: string | null,
  fileName: string | null
): Promise<SourcePreviewIndex> => {
  const [lists, named] = await Promise.all([
    loadShelfLists(projectId, conversationId),
    fileName ? resolveDocumentsByName(projectId, [fileName]) : Promise.resolve(null),
  ])
  const answers = named ? [...named.values()] : []
  return {
    storedDocuments: [
      ...toRefs(answers.flatMap((answer) => answer.project), 'project'),
      ...lists.sessionDocuments,
      ...toRefs(answers.flatMap((answer) => answer.officeShelf), 'office_shelf'),
    ],
    baseCorpusFiles: lists.baseCorpusFiles,
  }
}

const loadShelfLists = (
  projectId: string | null,
  conversationId: string | null
): Promise<ShelfLists> => {
  const key = `${projectId ?? '__no-project__'}|${conversationId ?? '__no-conversation__'}`
  const existing = indexCache.get(key)
  if (existing) return existing

  const promise = (async (): Promise<ShelfLists> => {
    const [sessionResult, corpusResult] = await Promise.allSettled([
      conversationId
        ? fetch(`/api/session/documents?conversationId=${encodeURIComponent(conversationId)}`).then(
            (r) => (r.ok ? r.json() : null)
          )
        : Promise.resolve(null),
      fetch('/api/knowledge-base').then((r) => (r.ok ? r.json() : null)),
    ])
    const sessionDocs = sessionResult.status === 'fulfilled' ? sessionResult.value?.documents : null
    const files = corpusResult.status === 'fulfilled' ? corpusResult.value?.files : null

    const baseCorpusFiles: string[] = Array.isArray(files)
      ? files
          .filter(
            (file): file is { fileName: string; state?: string; origin?: string } =>
              !!file && typeof file.fileName === 'string'
          )
          .filter((file) => file.state !== 'removed' && file.origin !== 'index_only')
          .map((file) => file.fileName)
      : []

    return { sessionDocuments: toRefs(sessionDocs, 'session'), baseCorpusFiles }
  })()

  indexCache.set(key, promise)
  return promise
}
