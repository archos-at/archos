import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { sessionCollectionName } from '@/lib/retrieval-scope/collection-scope'
import { OFFICE_SHELF, projectShelf } from '@/lib/documents/shelf'
import { officeShelfCollectionNames } from '@/lib/office-shelf/collection'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { reachForAudience, type SearchReach } from '@/lib/search/reach'
import type { SearchScope } from '@/lib/search/search-wire'
import {
  decodeTreeCursor,
  encodeTreeCursor,
  findFolderIdByPath,
  listTreeDocuments,
  listTreeFolders,
  type TreeDocumentRow,
  type TreeFolderRow,
  type TreeSource,
} from './repository'
import {
  ESTATE_TREE_PAGE_DEFAULT,
  type EstateTreeDocument,
  type EstateTreeFolder,
  type EstateTreeRequest,
  type EstateTreeResponse,
} from './types'

const notInScope = () => new NotFoundError('No such shelf in this turn.')
const noFolder = () => new NotFoundError('No folder with that path.')

async function resolveShelf(
  context: VerifiedRequestContext,
  session: AuthorizedSession,
  request: EstateTreeRequest,
): Promise<{ source: TreeSource; collection: string }> {
  const conversationId = context.conversationId
  if (!conversationId) throw notInScope()
  const signed = new Set(context.collectionScope)

  if (request.shelf === 'session') {
    const collection = sessionCollectionName(conversationId)
    if (!signed.has(collection) || request.folder_path) throw request.folder_path ? noFolder() : notInScope()
    const reach = await reachForAudience(session, conversationId, { kind: 'office_shelf' })
    return { source: { kind: 'session', reach, conversationId }, collection }
  }

  if (request.shelf === 'office_shelf') {
    const names = officeShelfCollectionNames(context.organizationId).filter((name) => signed.has(name))
    if (names.length === 0) throw notInScope()
    const folderId = request.folder_path ? await findFolderIdByPath(context.organizationId, OFFICE_SHELF, request.folder_path) : null
    if (request.folder_path && !folderId) throw noFolder()
    const scope: SearchScope = { kind: 'office_shelf', ...(folderId ? { folderId } : {}) }
    return { source: { kind: 'reach', reach: await listed(session, conversationId, scope, folderId) }, collection: names[0] }
  }

  const projectId = context.projectId
  if (!projectId) throw notInScope()
  const folderId = request.folder_path ? await findFolderIdByPath(context.organizationId, projectShelf(projectId), request.folder_path) : null
  if (request.folder_path && !folderId) throw noFolder()
  const reach = await listed(session, conversationId, { kind: 'project', projectId, ...(folderId ? { folderId } : {}) }, folderId)
  const project = reach.projects.find((reached) => reached.project.id === projectId)?.project
  if (!project || !signed.has(project.collectionName)) throw notInScope()
  return { source: { kind: 'reach', reach }, collection: project.collectionName }
}

async function listed(
  session: AuthorizedSession,
  conversationId: string,
  scope: SearchScope,
  folderId: string | null,
): Promise<SearchReach> {
  let reach: SearchReach
  try {
    reach = await reachForAudience(session, conversationId, scope, { listing: true, includeOwnProject: true })
  } catch (error) {
    if (error instanceof NotFoundError) throw folderId ? noFolder() : notInScope()
    throw error
  }
  if (folderId && !reach.folderIds?.includes(folderId)) throw noFolder()
  return reach
}

function folderView(row: TreeFolderRow): EstateTreeFolder {
  return {
    id: row.id,
    parent_id: row.parentId,
    name: row.name,
    path: row.path,
    description: row.description,
    card: row.cardStatus ? { status: row.cardStatus, generated_at: row.cardGeneratedAt?.toISOString() ?? null } : null,
  }
}

function documentView(row: TreeDocumentRow): EstateTreeDocument {
  return {
    id: row.id,
    filename: row.filename,
    display_name: row.displayName,
    folder_id: row.folderId,
    folder_path: row.folderPath,
    collection: row.collectionName,
    content_type: row.contentType,
    file_size: row.fileSize,
    status: row.status,
    authored_by: row.authoredBy,
    document_type: row.documentType,
    page_count: row.pageCount,
    superseded: row.superseded,
    plan_number: row.planNumber,
    plan_index: row.planIndex,
    plan_date: row.planDate,
    published_version: row.publishedVersion,
    version_count: row.versionCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function readEstateTree(
  context: VerifiedRequestContext,
  session: AuthorizedSession,
  request: EstateTreeRequest,
): Promise<EstateTreeResponse> {
  const { source, collection } = await resolveShelf(context, session, request)
  const limit = request.limit ?? ESTATE_TREE_PAGE_DEFAULT
  const cursor = request.cursor ? decodeTreeCursor(request.cursor) : null
  const [folders, rows] = await Promise.all([
    source.kind === 'reach' ? listTreeFolders(source.reach) : Promise.resolve({ rows: [], truncated: false }),
    listTreeDocuments(source, { cursor, limit }),
  ])
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    shelf: request.shelf,
    collection,
    folders: folders.rows.map(folderView),
    folders_truncated: folders.truncated,
    documents: page.map(documentView),
    next_cursor: rows.length > limit && last ? encodeTreeCursor({ filename: last.filename, id: last.id }) : null,
  }
}
