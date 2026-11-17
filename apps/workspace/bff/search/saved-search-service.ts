import 'server-only'
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import { nextOffsetCursor, offsetPageOf } from '@/lib/api/offset-page'
import { isUniqueViolation } from '@/lib/db/errors'
import type { SavedSearchRow } from '@/lib/db/schema/saved-searches'
import { resolvePeople } from '@/lib/sharing/directory'
import {
  countOwnedSavedSearches,
  deleteOwnSavedSearch,
  insertSavedSearch,
  listVisibleSavedSearches,
  updateOwnSavedSearch,
  type SavedSearchOwner,
} from './saved-search-repository'
import {
  SAVED_SEARCHES_PER_PERSON_MAX,
  type CreateSavedSearchInput,
  type ListSavedSearchesQuery,
  type SavedSearchListResponse,
  type SavedSearchView,
  type UpdateSavedSearchInput,
} from './saved-search-wire'

const NAME_CONSTRAINT = 'saved_searches_owner_name_key'

export function toSavedSearchView(row: SavedSearchRow, readerUserId: string, ownerName: string | null = null): SavedSearchView {
  const ownedByMe = row.ownerUserId === readerUserId
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    query: row.query,
    shared: row.shared,
    ownedByMe,
    ownerName: ownedByMe ? null : ownerName,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

function namedProjects(row: SavedSearchRow): string[] {
  return [...(row.scope.projectId ? [row.scope.projectId] : []), ...(row.query.filters?.projectIds ?? [])]
}

export function savedSearchForReader(
  row: SavedSearchRow,
  readerUserId: string,
  viewable: ReadonlySet<string>
): SavedSearchRow | null {
  if (row.ownerUserId === readerUserId) return row
  if (row.scope.projectId && !viewable.has(row.scope.projectId)) return null
  const projectIds = row.query.filters?.projectIds
  if (!projectIds || projectIds.every((id) => viewable.has(id))) return row
  const kept = projectIds.filter((id) => viewable.has(id))
  if (kept.length === 0) return null
  return { ...row, query: { ...row.query, filters: { ...row.query.filters, projectIds: kept } } }
}

export async function listSavedSearches(
  reader: SavedSearchOwner,
  query: ListSavedSearchesQuery,
  viewableProjects: () => Promise<ReadonlySet<string>>
): Promise<SavedSearchListResponse> {
  const page = offsetPageOf(query)
  const fetched = await listVisibleSavedSearches(reader, page)
  const onPage = fetched.slice(0, page.limit)
  const namesProjects = onPage.some((row) => row.ownerUserId !== reader.userId && namedProjects(row).length > 0)
  const viewable = namesProjects ? await viewableProjects() : new Set<string>()
  const rows = onPage.flatMap((row) => savedSearchForReader(row, reader.userId, viewable) ?? [])
  const colleagues = [...new Set(rows.map((row) => row.ownerUserId).filter((userId) => userId !== reader.userId))]
  const people = await resolvePeople(reader.organizationId, colleagues)
  return {
    savedSearches: rows.map((row) => toSavedSearchView(row, reader.userId, people.get(row.ownerUserId)?.name ?? null)),
    nextCursor: nextOffsetCursor(page, fetched.length),
  }
}

export async function createSavedSearch(owner: SavedSearchOwner, input: CreateSavedSearchInput): Promise<SavedSearchView> {
  if ((await countOwnedSavedSearches(owner)) >= SAVED_SEARCHES_PER_PERSON_MAX) {
    throw new UnprocessableError(`You already keep ${SAVED_SEARCHES_PER_PERSON_MAX} saved searches; delete one first.`)
  }
  try {
    const row = await insertSavedSearch(owner, input)
    return toSavedSearchView(row, owner.userId)
  } catch (error) {
    if (isUniqueViolation(error, NAME_CONSTRAINT)) throw duplicateName(input.name)
    throw error
  }
}

export async function updateSavedSearch(
  owner: SavedSearchOwner,
  id: string,
  patch: UpdateSavedSearchInput
): Promise<SavedSearchView> {
  try {
    const row = await updateOwnSavedSearch(owner, id, patch)
    if (!row) throw new NotFoundError('Saved search not found')
    return toSavedSearchView(row, owner.userId)
  } catch (error) {
    if (patch.name !== undefined && isUniqueViolation(error, NAME_CONSTRAINT)) throw duplicateName(patch.name)
    throw error
  }
}

export async function deleteSavedSearch(owner: SavedSearchOwner, id: string): Promise<void> {
  if (!(await deleteOwnSavedSearch(owner, id))) throw new NotFoundError('Saved search not found')
}

function duplicateName(name: string): ConflictError {
  return new ConflictError(`You already have a saved search named "${name}".`)
}
