import { documentReadFamily } from '@/lib/documents/document-status'
import type { DocumentHit } from '@/lib/search/search-wire'
import type { RegisterColumn } from './search-sort'

export function registerCellEmpty(column: RegisterColumn, hit: DocumentHit): boolean {
  switch (column) {
    case 'planNumber':
      return !hit.planNumber
    case 'planIndex':
      return !hit.planIndex
    case 'title':
      return false
    case 'planDate':
      return !hit.planDate
    case 'scale':
      return !hit.scale
    case 'documentType':
      return !hit.documentType
    case 'author':
      return !hit.author
    case 'project':
      return hit.shelf !== 'office_shelf' && !hit.projectName
    case 'folder':
      return !hit.folderName
    case 'uploaded':
      return !hit.uploadedAt
    case 'pages':
      return hit.pageCount === null
    case 'status':
      return documentReadFamily(hit.status) === 'readable'
  }
}

export function titleSpan(columns: readonly RegisterColumn[], hit: DocumentHit): number {
  const at = columns.indexOf('title')
  if (at === -1) return 1
  let span = 1
  while (at + span < columns.length && registerCellEmpty(columns[at + span]!, hit)) span += 1
  return span
}
