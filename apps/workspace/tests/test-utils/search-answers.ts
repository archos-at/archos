import type { FileItem } from '@/features/documents/file-types'
import type { DocumentHit, SearchResponse, SearchScope } from '@/lib/search/search-wire'

export function fileSearchHit(file: FileItem, passage: { text: string; page: number | null } | null = null): DocumentHit {
  return {
    kind: 'document',
    id: file.id,
    name: file.displayName ?? file.filename,
    filename: file.filename,
    shelf: 'project',
    projectId: null,
    projectName: null,
    folderId: file.folderId,
    folderName: null,
    folderPath: '',
    status: file.status ?? 'completed',
    contentType: file.contentType,
    uploadedAt: file.createdAt,
    uploadedBy: null,
    documentType: null,
    title: null,
    planNumber: null,
    planIndex: null,
    planDate: null,
    scale: null,
    documentDate: null,
    pageCount: file.pageCount,
    pagesNotRead: null,
    superseded: false,
    changedFacts: [],
    municipality: null,
    author: null,
    matchedOn: passage ? ['content'] : ['name'],
    passage,
  }
}

export function documentSearchAnswer(hits: DocumentHit[], scope: SearchScope = { kind: 'office_shelf' }): SearchResponse {
  return {
    scope,
    setAside: {},
    sections: { document: { hits, total: hits.length, totalIsLowerBound: false, nextCursor: null } },
    facets: null,
    unread: null,
    building: [],
    contentPartial: false,
  }
}
