'use client'

import { useEffect, useState } from 'react'
import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { toFileItem, type DocumentWireRow } from '@/features/documents/lib/file-item'
import { fetchListingPages } from '@/features/documents/lib/fetch-listing-pages'
import { restrictedCollectionBase } from '@/lib/authz/folder-access-rule'
import type { PlanDocument } from '@/lib/runs/plan-documents'

export interface InventoryDocument extends PlanDocument {
  file: FileItem
  source: 'project' | 'office'
  restricted: boolean
}

type InventoryWireRow = DocumentWireRow & { collectionName?: string | null }

const listing = async (url: string): Promise<InventoryWireRow[]> => {
  try {
    return (await fetchListingPages<InventoryWireRow>(url)).documents
  } catch {
    return []
  }
}

const toInventory = (rows: InventoryWireRow[], source: InventoryDocument['source']): InventoryDocument[] =>
  rows.map((row) => {
    const file = toFileItem(row)
    const title = file.displayName?.trim()
    return {
      name: file.filename,
      ...(title && title !== file.filename ? { title } : {}),
      shelf: source === 'office' ? 'office_shelf' : 'project',
      file,
      source,
      restricted: restrictedCollectionBase(row.collectionName ?? '') !== null,
    }
  })

export function useProjectInventory(projectId: string | null, enabled: boolean): {
  documents: InventoryDocument[] | null
  loading: boolean
} {
  const [loaded, setLoaded] = useState<{ projectId: string; documents: InventoryDocument[] } | null>(
    null
  )
  const [loading, setLoading] = useState(false)
  const documents = loaded && loaded.projectId === projectId ? loaded.documents : null

  useEffect(() => {
    if (!enabled || !projectId || documents !== null) return
    let cancelled = false
    setLoading(true)
    void Promise.all([
      listing(`/api/documents?projectId=${encodeURIComponent(projectId)}`),
      listing('/api/documents?scope=office_shelf&includeStandards=true'),
    ]).then(([project, officeShelf]) => {
      if (cancelled) return
      setLoaded({
        projectId,
        documents: [...toInventory(project, 'project'), ...toInventory(officeShelf, 'office')],
      })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, projectId, documents])

  return { documents, loading }
}
