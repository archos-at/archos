import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import { liveFolderAccess } from '@/lib/permits/live-access'
import { servedFrom } from '@/lib/permits/repository'

export interface MemoryEvidence {
  fileName: string
  page: string | null
}

export interface WithEvidence {
  projectId: string | null
  evidence: MemoryEvidence[] | null
}

export interface EvidenceReader {
  reader: DocumentReader
  clearanceIn(projectId: string): readonly string[]
}

async function servedNames(
  organizationId: string,
  projectId: string,
  fileNames: readonly string[],
  reader: EvidenceReader
): Promise<Set<string>> {
  const access = await liveFolderAccess(organizationId, projectId, reader.clearanceIn(projectId))
  const rows = await getDb()
    .selectDistinct({ fileName: documents.filename })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.projectId, projectId),
        inArray(documents.filename, [...fileNames]),
        documentVisibleTo(reader.reader),
        eq(documents.lifecycle, 'active'),
        servedFrom(access.visibleFolderIds)
      )
    )
  return new Set(rows.map((row) => row.fileName))
}

export async function withServedEvidence<Item extends WithEvidence>(
  organizationId: string,
  items: readonly Item[],
  reader: EvidenceReader
): Promise<Item[]> {
  const namesByProject = new Map<string, Set<string>>()
  for (const item of items) {
    if (!item.projectId || !item.evidence || item.evidence.length === 0) continue
    const names = namesByProject.get(item.projectId) ?? new Set<string>()
    for (const entry of item.evidence) names.add(entry.fileName)
    namesByProject.set(item.projectId, names)
  }
  if (namesByProject.size === 0) return [...items]
  const served = new Map(
    await Promise.all(
      [...namesByProject].map(
        async ([projectId, names]) => [projectId, await servedNames(organizationId, projectId, [...names], reader)] as const
      )
    )
  )
  return items.map((item) => {
    if (!item.projectId || !item.evidence || item.evidence.length === 0) return item
    const open = served.get(item.projectId)
    return { ...item, evidence: item.evidence.filter((entry) => open?.has(entry.fileName) ?? false) }
  })
}
