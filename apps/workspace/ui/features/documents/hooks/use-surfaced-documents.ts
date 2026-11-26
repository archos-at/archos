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
import { isDocumentId, resetDocumentsByIdCache, resolveDocumentsById } from '../documents-by-id'
import { toFileItem } from '../lib/file-item'

export interface SurfacedDocument {
  file_name: string
  document_id?: string | null
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

type NameIndex = Map<string, FileItem | null>

interface SurfacedIndex {
  project: NameIndex
  officeShelf: NameIndex
  session: NameIndex
  error: boolean
}

interface IdentifiedIndex {
  project: Map<string, FileItem>
  officeShelf: Map<string, FileItem>
  error: boolean
}

const indexCache = new Map<string, Promise<SurfacedIndex>>()

const cacheKey = (projectId: string | null, conversationId: string | null): string =>
  `${projectId ?? '__no-project__'}|${conversationId ?? '__no-conversation__'}`

export const resetSurfacedDocumentsCache = (): void => {
  indexCache.clear()
  resetDocumentsByNameCache()
  resetDocumentsByIdCache()
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

function indexByFilename(rows: unknown): NameIndex {
  const map: NameIndex = new Map()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const file = row as FileItem
    if (typeof file.id !== 'string' || typeof file.filename !== 'string') continue
    const key = documentNameLookupKey(file.filename)
    const existing = map.get(key)
    map.set(key, existing === undefined || existing?.id === file.id ? file : null)
  }
  return map
}

const corpusLookup = (corpus: NameIndex, fileName: string): FileItem | undefined =>
  corpus.get(documentNameLookupKey(fileName)) ?? undefined

async function loadIdentified(projectId: string | null, ids: readonly string[]): Promise<IdentifiedIndex> {
  const found = await resolveDocumentsById(projectId, ids)
  const pick = (side: 'project' | 'officeShelf') =>
    new Map([...found].flatMap(([id, answer]) => (answer[side] ? [[id, toFileItem(answer[side])] as const] : [])))
  return {
    project: pick('project'),
    officeShelf: pick('officeShelf'),
    error: [...found.values()].some((answer) => answer.error),
  }
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
  const corpora: ReadonlyArray<readonly [DocumentCorpus, NameIndex]> = [
    ['session', index.session],
    ['office', index.officeShelf],
    ['project', index.project],
  ]
  for (const [corpus, rows] of corpora) {
    for (const [key, file] of rows) {
      if (file) byName.set(key, { file, corpus })
      else byName.delete(key)
    }
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
  const [index, setIndex] = useState<{ named: SurfacedIndex; identified: IdentifiedIndex } | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const generation = useDocumentsGeneration()

  const namesKey = useMemo(
    () =>
      JSON.stringify(
        [...new Set(documents.filter((doc) => !isDocumentId(doc.document_id)).map((doc) => documentNameLookupKey(doc.file_name)))].sort()
      ),
    [documents]
  )
  const idsKey = useMemo(
    () => JSON.stringify([...new Set(documents.flatMap((doc) => (isDocumentId(doc.document_id) ? [doc.document_id] : [])))].sort()),
    [documents]
  )

  useEffect(() => {
    let cancelled = false
    setIndex(null)
    Promise.all([
      loadNamedIndex(projectId, JSON.parse(namesKey) as string[]),
      loadIdentified(projectId, JSON.parse(idsKey) as string[]),
    ])
      .then(([named, identified]) => {
        if (!cancelled) setIndex({ named, identified })
      })
      .catch(() => {
        if (!cancelled) {
          setIndex({
            named: { project: new Map(), officeShelf: new Map(), session: new Map(), error: true },
            identified: { project: new Map(), officeShelf: new Map(), error: true },
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, namesKey, idsKey, reloadTick, generation])

  const retry = useCallback(() => {
    setReloadTick((t) => t + 1)
  }, [])

  const resolved = useMemo<ResolvedSurfacedDocument[]>(
    () =>
      documents.map((surfaced, i) => {
        const key = `${surfaced.file_name}-${i}`
        if (!index) return { key, surfaced, file: null, docSource: null }

        if (isDocumentId(surfaced.document_id)) {
          const { project, officeShelf } = index.identified
          const inProject = surfaced.source === 'office' ? undefined : project.get(surfaced.document_id)
          const inOffice = surfaced.source === 'project' ? undefined : officeShelf.get(surfaced.document_id)
          if (inProject) return { key, surfaced, file: inProject, docSource: 'project' }
          if (inOffice) return { key, surfaced, file: inOffice, docSource: 'office' }
          return { key, surfaced, file: null, docSource: null }
        }

        const named = index.named
        if (surfaced.source === 'project' || surfaced.source === 'office') {
          const map = surfaced.source === 'office' ? named.officeShelf : named.project
          const hit = corpusLookup(map, surfaced.file_name)
          return hit
            ? { key, surfaced, file: hit, docSource: surfaced.source }
            : { key, surfaced, file: null, docSource: null }
        }

        const inProject = named.project.get(documentNameLookupKey(surfaced.file_name))
        if (inProject) return { key, surfaced, file: inProject, docSource: 'project' }
        if (inProject === null) return { key, surfaced, file: null, docSource: null }
        const inOfficeShelf = corpusLookup(named.officeShelf, surfaced.file_name)
        if (inOfficeShelf) return { key, surfaced, file: inOfficeShelf, docSource: 'office' }
        return { key, surfaced, file: null, docSource: null }
      }),
    [documents, index]
  )

  return {
    resolved,
    isLoading: index === null,
    error: (index?.named.error ?? false) || (index?.identified.error ?? false),
    retry,
  }
}
