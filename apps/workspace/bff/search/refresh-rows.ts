import 'server-only'
import { collectionFileRef, type CollectionFileRef } from '@/lib/documents/collection-file-ref'
import { readCollectionReadings } from '@/lib/documents/reconcile-status'
import { documentShelf, type DocumentShelf } from '@/lib/documents/shelf'
import { projectReadings, type DocumentReading } from './facets-projector'
import { markShelvesStale, type ProjectionDocument } from './facets-repository'

export interface SearchRowDocument extends ProjectionDocument {
  scope?: string
  projectId: string | null
}

export async function projectDocuments(organizationId: string, docs: readonly ProjectionDocument[]): Promise<number> {
  const byCollection = new Map<string, Array<{ id: string; ref: CollectionFileRef }>>()
  for (const document of docs) {
    const ref = collectionFileRef(document)
    if (!ref) continue
    const group = byCollection.get(ref.collectionName) ?? []
    group.push({ id: document.id, ref })
    byCollection.set(ref.collectionName, group)
  }
  const readings: DocumentReading[] = []
  for (const [collectionName, entries] of byCollection) {
    const listed = await readCollectionReadings(
      collectionName,
      entries.map((entry) => entry.ref)
    )
    if (!listed) throw new Error(`search projection: listing of ${collectionName} unreadable`)
    for (const entry of entries) {
      const reading = listed.get(entry.ref.filename)
      if (reading) readings.push({ documentId: entry.id, ...reading })
    }
  }
  return projectReadings(organizationId, readings)
}

export async function refreshSearchRows(organizationId: string, docs: readonly SearchRowDocument[]): Promise<void> {
  if (docs.length === 0) return
  try {
    await projectDocuments(organizationId, docs)
  } catch (error) {
    console.warn('[search] refreshing the search rows of edited documents failed', error)
    await markShelvesStale(organizationId, shelvesOf(docs)).catch((staleError: unknown) =>
      console.warn('[search] could not mark the shelves stale', staleError)
    )
  }
}

function shelvesOf(docs: readonly SearchRowDocument[]): DocumentShelf[] {
  const shelves = new Map<string, DocumentShelf>()
  for (const doc of docs) {
    const shelf = documentShelf(doc)
    if (shelf) shelves.set(shelf.kind === 'project' ? shelf.projectId : 'office_shelf', shelf)
  }
  return [...shelves.values()]
}
