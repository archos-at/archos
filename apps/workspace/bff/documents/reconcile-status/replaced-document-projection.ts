import { listCollectionDocumentsForProjection } from '@/lib/search/facets-repository'
import { projectReadings } from '@/lib/search/facets-projector'
import { collectionFileRef } from '../collection-file-ref'
import type { CollectionFiles } from './collection-listing-types'
import { readingsIn } from './reading-metadata'

export interface ReplacedVersions {
  collectionName: string
  files: CollectionFiles
  names: readonly string[]
}

export async function projectReplacedDocuments(
  organizationId: string,
  replaced: readonly ReplacedVersions[]
): Promise<void> {
  const byCollection = new Map<string, { files: CollectionFiles; names: Set<string> }>()
  for (const { collectionName, files, names } of replaced) {
    if (files.readingUnavailable) continue
    const group = byCollection.get(collectionName) ?? { files, names: new Set<string>() }
    for (const name of names) group.names.add(name)
    byCollection.set(collectionName, group)
  }
  for (const [collectionName, { files, names }] of byCollection) {
    const documents = await listCollectionDocumentsForProjection(organizationId, collectionName, [...names])
    const refs = documents.flatMap((document) => {
      const ref = collectionFileRef(document)
      return ref ? [{ id: document.id, ref }] : []
    })
    const readings = readingsIn(
      files,
      collectionName,
      refs.map((entry) => entry.ref)
    )
    await projectReadings(
      organizationId,
      refs.flatMap((entry) => {
        const reading = readings.get(entry.ref.filename)
        return reading ? [{ documentId: entry.id, ...reading }] : []
      })
    )
  }
}
