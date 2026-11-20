'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileItem } from '../components/project-file-workspace'
import { onDocumentsChanged, useDocumentsGeneration } from '@/lib/documents/document-changes'
import { fetchListingPages, ListingFetchError } from '../lib/fetch-listing-pages'
import {
  documentNameLookupKey,
  resetDocumentsByNameCache,
  resolveDocumentsByName,
} from '../lib/documents-by-name'

export interface SurfacedDocument {
  file_name: string
  summary?: string | null
  snippet?: string | null
  page?: number | null
  score?: number | null
  source?: 'project' | 'office' | null
}

export type DocumentCorpus = 'project' | 'office' | 'session'

export interface ResolvedSurfacedDocument {
  key: string
  surfaced: SurfacedDocument
  file: FileItem | null
  docSource: 'project' | 'office' | null
}

interface SurfacedIndex {
  project: Map<string, FileItem>
  officeShelf: Map<string, FileItem>
  session: Map<string, FileItem>
  error: boolean
}

const indexCache = new Map<string, Promise<SurfacedIndex>>()

const cacheKey = (projectId: string | null, conversationId: string | null): string =>
  `${projectId ?? '__no-project__'}|${conversationId ?? '__no-conversation__'}`

export const resetSurfacedDocumentsCache = (): void => {
  indexCache.clear()
  resetDocumentsByNameCache()
}

onDocumentsChanged(resetSurfacedDocumentsCache)

async function fetchCorpus(
  url: string,
  softStatuses: number[]
): Promise<{ rows: unknown; failed: boolean }> {
  try {
    const { documents } = await fetchListingPages<unknown>(url)
    return { rows: documents, failed: false }
  } catch (error) {
    const status = error instanceof ListingFetchError ? error.status : null
    return { rows: null, failed: status === null || !softStatuses.includes(status) }
  }
}

function indexByFilename(rows: unknown): Map<string, FileItem> {
  const map = new Map<string, FileItem>()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const file = row as FileItem
    if (typeof file.id !== 'string' || typeof file.filename !== 'string') continue
    const key = file.filename.toLowerCase()
    const existing = map.get(key)
    if (!existing || new Date(file.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      map.set(key, file)
    }
  }
  return map
}

const corpusLookup = (corpus: Map<string, FileItem>, fileName: string): FileItem | undefined =>
  corpus.get(fileName.trim().toLowerCase())

export async function resolveStoredDocument(
  projectId: string | null,
  fileName: string,
  source: 'project' | 'office',
): Promise<FileItem | null> {
  const index = await loadNamedIndex(projectId, [fileName])
  return corpusLookup(source === 'office' ? index.officeShelf : index.project, fileName) ?? null
}

async function loadNamedIndex(projectId: string | null, names: readonly string[]): Promise<SurfacedIndex> {
  const named = await resolveDocumentsByName(projectId, names)
  const answers = [...named.values()]
  return {
    project: indexByFilename(answers.flatMap((answer) => answer.project)),
    officeShelf: indexByFilename(answers.flatMap((answer) => answer.officeShelf)),
    session: new Map(),
    error: answers.some((answer) => answer.error),
  }
}

export interface StoredFile {
  file: FileItem
  corpus: DocumentCorpus
}

export async function storedFileIndex(
  projectId: string | null,
  conversationId: string | null
): Promise<Map<string, StoredFile>> {
  const index = await loadSurfacedIndex(projectId, conversationId)
  const byName = new Map<string, StoredFile>()
  const corpora: ReadonlyArray<readonly [DocumentCorpus, Map<string, FileItem>]> = [
    ['session', index.session],
    ['office', index.officeShelf],
    ['project', index.project],
  ]
  for (const [corpus, rows] of corpora) {
    for (const [key, file] of rows) byName.set(key, { file, corpus })
  }
  return byName
}

function loadSurfacedIndex(
  projectId: string | null,
  conversationId: string | null
): Promise<SurfacedIndex> {
  const key = cacheKey(projectId, conversationId)
  const existing = indexCache.get(key)
  if (existing) return existing

  const promise = (async (): Promise<SurfacedIndex> => {
    const [projectRes, officeShelfRes, sessionRes] = await Promise.all([
      projectId
        ? fetchCorpus(`/api/documents?projectId=${encodeURIComponent(projectId)}`, [])
        : Promise.resolve({ rows: null, failed: false }),
      fetchCorpus('/api/documents?scope=office_shelf&includeStandards=true', [403, 404]),
      conversationId
        ? fetchCorpus(
            `/api/session/documents?conversationId=${encodeURIComponent(conversationId)}`,
            [403, 404]
          )
        : Promise.resolve({ rows: null, failed: false }),
    ])
    return {
      project: indexByFilename(projectRes.rows),
      officeShelf: indexByFilename(officeShelfRes.rows),
      session: indexByFilename(sessionRes.rows),
      error: projectRes.failed || officeShelfRes.failed || sessionRes.failed,
    }
  })()

  indexCache.set(key, promise)
  promise
    .then((idx) => {
      if (idx.error) indexCache.delete(key)
    })
    .catch(() => indexCache.delete(key))
  return promise
}

export function useSurfacedDocuments(
  documents: SurfacedDocument[],
  projectId: string | null
): { resolved: ResolvedSurfacedDocument[]; isLoading: boolean; error: boolean; retry: () => void } {
  const [index, setIndex] = useState<SurfacedIndex | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const generation = useDocumentsGeneration()

  const namesKey = useMemo(
    () => JSON.stringify([...new Set(documents.map((doc) => documentNameLookupKey(doc.file_name)))].sort()),
    [documents]
  )

  useEffect(() => {
    let cancelled = false
    setIndex(null)
    loadNamedIndex(projectId, JSON.parse(namesKey) as string[])
      .then((loaded) => {
        if (!cancelled) setIndex(loaded)
      })
      .catch(() => {
        if (!cancelled) {
          setIndex({ project: new Map(), officeShelf: new Map(), session: new Map(), error: true })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, namesKey, reloadTick, generation])

  const retry = useCallback(() => {
    setReloadTick((t) => t + 1)
  }, [])

  const resolved = useMemo<ResolvedSurfacedDocument[]>(
    () =>
      documents.map((surfaced, i) => {
        const key = `${surfaced.file_name}-${i}`
        if (!index) return { key, surfaced, file: null, docSource: null }

        if (surfaced.source === 'project' || surfaced.source === 'office') {
          const map = surfaced.source === 'office' ? index.officeShelf : index.project
          const hit = corpusLookup(map, surfaced.file_name)
          return hit
            ? { key, surfaced, file: hit, docSource: surfaced.source }
            : { key, surfaced, file: null, docSource: null }
        }

        const inProject = corpusLookup(index.project, surfaced.file_name)
        if (inProject) return { key, surfaced, file: inProject, docSource: 'project' }
        const inOfficeShelf = corpusLookup(index.officeShelf, surfaced.file_name)
        if (inOfficeShelf) return { key, surfaced, file: inOfficeShelf, docSource: 'office' }
        return { key, surfaced, file: null, docSource: null }
      }),
    [documents, index]
  )

  return { resolved, isLoading: index === null, error: index?.error ?? false, retry }
}
