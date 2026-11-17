import { OFFICE_TIME_ZONE } from '@/lib/format'
import 'server-only'
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { executeRows } from '@/lib/db/execute-rows'
import { documentSearchFacets, type SearchFacetChange } from '@/lib/db/schema/document-search'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { projects } from '@/lib/db/schema/projects'
import { withTenant } from '@/lib/db/tenant-context'
import { squashDrawingNumber } from '@/lib/documents/findings'
import { nameContains, readFamilyWhere } from '@/lib/documents/repository'
import { documentVisibleTo } from '@/lib/documents/visibility'
import { likeContains } from '@/lib/text/like-pattern'
import { factToken } from './facets'
import { reachReader, type SearchReach } from './reach'
import type { DocumentFilters, SearchSort } from './search-wire'

const f = documentSearchFacets

const SEARCH_VECTOR = sql.raw('"document_search_facets"."search_vector"')

const TOKEN = /^(norm|law|plan|document):.+$/

export interface ReferenceTargets {
  planKeys: readonly string[]
  documentTypes: readonly string[]
}

export interface TextMatch {
  text: string
  contentKeys: readonly string[]
  contentIds?: readonly string[]
}

export interface DocumentQuery {
  filters: DocumentFilters
  text: TextMatch | null
  citedBy: ReferenceTargets | null
  citing: ReferenceTargets | null
}

const CONTENT_KEY_SEPARATOR = '\u001f'

export function contentKey(collectionName: string, filename: string): string {
  return `${collectionName}${CONTENT_KEY_SEPARATOR}${filename}`
}

const contentKeyOf = sql`(${documents.collectionName} || chr(31) || ${documents.filename})`

export function reachWhere(reach: SearchReach, includeArchived: boolean): SQL | undefined {
  const projectIds = reach.projects.map((reached) => reached.project.id)
  const hidden = reach.projects.flatMap((reached) => reached.hiddenFolderIds)
  const shelves = or(
    projectIds.length > 0 ? and(eq(documents.scope, 'project'), inArray(documents.projectId, projectIds)) : undefined,
    reach.officeShelf ? eq(documents.scope, 'office_shelf') : undefined
  )
  return and(
    eq(documents.organizationId, reach.organizationId),
    shelves ?? sql`false`,
    includeArchived ? undefined : eq(documents.lifecycle, 'active'),
    hidden.length > 0 ? or(isNull(documents.folderId), notInArray(documents.folderId, hidden)) : undefined,
    reach.folderIds ? (reach.folderIds.length > 0 ? inArray(documents.folderId, [...reach.folderIds]) : sql`false`) : undefined,
    documentVisibleTo(reachReader(reach))
  )
}

const between = (column: SQL | typeof f.planDate, range: { from?: string; to?: string } | undefined): SQL[] => [
  ...(range?.from ? [sql`${column} >= ${range.from}`] : []),
  ...(range?.to ? [sql`${column} <= ${range.to}`] : []),
]

function citesWhere(entry: string): SQL {
  const lowered = entry.normalize('NFC').toLowerCase().trim()
  if (TOKEN.test(lowered)) return sql`${f.referenceTokens} @> ARRAY[${lowered}]::text[]`
  const squashed = squashDrawingNumber(lowered)
  return or(
    sql`EXISTS (SELECT 1 FROM unnest(${f.referenceTokens}) AS token WHERE regexp_replace(token, '[\\s\\-_]+', '', 'g') LIKE ${likeContains(squashed)})`,
    sql`EXISTS (SELECT 1 FROM jsonb_each_text(${f.referenceLabels}) AS label WHERE lower(label.value) LIKE ${likeContains(lowered)})`
  ) as SQL
}

function partyWhere(party: NonNullable<DocumentFilters['parties']>[number]): SQL {
  if (!party.name) return sql`${f.partyRoles} @> ARRAY[${party.role}]::text[]`
  return sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${f.parties}) AS party
    WHERE lower(party->>'name') LIKE ${likeContains(party.name.toLowerCase())}
    ${party.role ? sql`AND party->>'role' = ${party.role}` : sql``})`
}

function factWhere(fact: NonNullable<DocumentFilters['facts']>[number]): SQL {
  const number = sql`(${f.factNumbers}->>${fact.key})::numeric`
  return and(
    fact.equals !== undefined ? sql`${f.factTokens} @> ARRAY[${factToken(fact.key, fact.equals)}]::text[]` : undefined,
    fact.min !== undefined ? sql`${number} >= ${fact.min}` : undefined,
    fact.max !== undefined ? sql`${number} <= ${fact.max}` : undefined
  ) as SQL
}

function targetsWhere(targets: ReferenceTargets): SQL {
  return or(
    targets.planKeys.length > 0 ? inArray(f.planNumberKey, [...targets.planKeys]) : undefined,
    targets.documentTypes.length > 0 ? inArray(f.documentType, [...targets.documentTypes]) : undefined
  ) ?? sql`false`
}

export function filtersWhere(filters: DocumentFilters, timeZone: string = OFFICE_TIME_ZONE): SQL[] {
  const where: SQL[] = []
  const anyOf = (parts: SQL[]): void => {
    if (parts.length > 0) where.push(or(...parts) as SQL)
  }
  if (filters.documentTypes?.length) where.push(inArray(f.documentType, filters.documentTypes))
  if (filters.tags?.length) where.push(sql`${f.tags} && ${sql`ARRAY[${sql.join(filters.tags.map((tag) => sql`${tag}`), sql`, `)}]::text[]`}`)
  if (filters.planNumber) where.push(sql`${f.planNumberKey} LIKE ${`${squashDrawingNumber(filters.planNumber).replace(/[\\%_]/g, '\\$&')}%`}`)
  if (filters.planIndex?.length) where.push(inArray(sql`lower(${f.planIndex})`, filters.planIndex.map((index) => index.toLowerCase())))
  where.push(...between(sql`${f.planDate}`, filters.planDate))
  if (filters.scale?.length) where.push(inArray(sql`replace(${f.scale}, ' ', '')`, filters.scale.map((scale) => scale.replace(/\s/g, ''))))
  if (filters.currentOnly) where.push(sql`coalesce(${f.superseded}, false) = false`)
  for (const party of filters.parties ?? []) where.push(partyWhere(party))
  if (filters.place) {
    where.push(sql`lower(concat_ws(' ', ${f.address}, ${f.municipality}, ${f.federalState})) LIKE ${likeContains(filters.place.toLowerCase())}`)
  }
  if (filters.municipalities?.length) {
    where.push(inArray(sql`lower(${f.municipality})`, filters.municipalities.map((name) => name.toLowerCase())))
  }
  if (filters.projectIds?.length) where.push(inArray(documents.projectId, filters.projectIds))
  for (const fact of filters.facts ?? []) where.push(factWhere(fact))
  for (const entry of filters.cites ?? []) where.push(citesWhere(entry))
  where.push(...between(sql`${f.documentDate}`, filters.documentDate))
  where.push(...between(sql`(${documents.createdAt} AT TIME ZONE ${timeZone})::date`, filters.uploaded))
  where.push(...between(sql`(${f.capturedAt} AT TIME ZONE ${timeZone})::date`, filters.photographed))
  if (filters.uploadedBy?.length) where.push(inArray(documents.createdBy, filters.uploadedBy))
  const family = readFamilyWhere(filters.states)
  if (family) where.push(family)
  if (filters.incompleteRead) where.push(sql`${f.pagesNotRead} > 0`)
  if (filters.factsChanged) where.push(sql`cardinality(${f.changedFactKeys}) > 0`)
  if (filters.changedFacts?.length) where.push(sql`${f.changedFactKeys} && ${pgTextArray(filters.changedFacts)}`)
  anyOf((filters.fileTypes ?? []).map((extension) => sql`lower(${documents.filename}) LIKE ${`%.${extension}`}`))
  if (filters.pages?.min !== undefined) where.push(gte(f.pageCount, filters.pages.min))
  if (filters.pages?.max !== undefined) where.push(lte(f.pageCount, filters.pages.max))
  return where
}

const tsQuery = (text: string): SQL =>
  sql`(websearch_to_tsquery('german', ${text}) || websearch_to_tsquery('german', fold_german(${text})))`

function textWhere(text: TextMatch): SQL {
  const squashed = squashDrawingNumber(text.text)
  return or(
    nameContains(text.text),
    sql`${SEARCH_VECTOR} @@ ${tsQuery(text.text)}`,
    squashed.length >= 2 ? sql`${f.planNumberKey} LIKE ${`${squashed.replace(/[\\%_]/g, '\\$&')}%`}` : undefined,
    text.contentKeys.length > 0
      ? sql`(${documents.authoredBy} = 'user' AND ${contentKeyOf} = ANY(${pgTextArray(text.contentKeys)}))`
      : undefined,
    contentIdsOf(text).length > 0 ? sql`${documents.id}::text = ANY(${pgTextArray(contentIdsOf(text))})` : undefined
  ) as SQL
}

export function documentSearchWhere(reach: SearchReach, query: DocumentQuery): SQL | undefined {
  return and(
    reachWhere(reach, query.filters.includeArchived === true),
    ne(documents.scope, 'session'),
    ...filtersWhere(query.filters, reach.timeZone),
    query.text ? textWhere(query.text) : undefined,
    query.citedBy ? targetsWhere(query.citedBy) : undefined,
    query.citing ? sql`EXISTS (SELECT 1 FROM unnest(${f.referenceTokens}) AS token WHERE
      (token LIKE 'plan:%' AND regexp_replace(substr(token, 6), '[\\s\\-_]+', '', 'g') = ANY(${pgTextArray(query.citing.planKeys)}))
      OR (token LIKE 'document:%' AND substr(token, 10) = ANY(${pgTextArray(query.citing.documentTypes)})))` : undefined
  )
}

function pgTextArray(values: readonly string[]): SQL {
  return values.length === 0 ? sql`ARRAY[]::text[]` : sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`
}

function contentIdsOf(text: TextMatch): string[] {
  return (text.contentIds ?? []).filter((id) => id !== '')
}

function contentPosition(text: TextMatch): SQL<number | null> {
  return sql<number | null>`coalesce(
    array_position(${pgTextArray(text.contentIds ?? [])}, ${documents.id}::text),
    CASE WHEN ${documents.authoredBy} = 'user' THEN array_position(${pgTextArray(text.contentKeys)}, ${contentKeyOf}) END
  )`
}

function relevance(text: TextMatch): SQL<number> {
  return sql<number>`(
    coalesce(ts_rank(${SEARCH_VECTOR}, ${tsQuery(text.text)}), 0)
    + CASE WHEN ${nameContains(text.text) ?? sql`false`} THEN 0.3 ELSE 0 END
  )`
}

const SORT_COLUMNS: Record<Exclude<SearchSort, 'relevance'>, SQL> = {
  name: sql`lower(coalesce(${documents.displayName}, ${documents.filename}))`,
  added: sql`${documents.createdAt}`,
  plan_number: sql`${f.planNumberKey}`,
  plan_index: sql`lower(${f.planIndex})`,
  plan_date: sql`${f.planDate}`,
  document_date: sql`${f.documentDate}`,
  document_type: sql`${f.documentType}`,
  page_count: sql`${f.pageCount}`,
  project: sql`lower(${projects.name})`,
  scale: sql`replace(${f.scale}, ' ', '')`,
  folder: sql`lower(${projectFolders.name})`,
  status: sql`lower(${documents.status})`,
  author: sql`lower(coalesce(
    (SELECT party->>'name' FROM jsonb_array_elements(${f.parties}) AS party WHERE party->>'role' = 'architect' LIMIT 1),
    (SELECT party->>'name' FROM jsonb_array_elements(${f.parties}) AS party WHERE party->>'role' = 'author' LIMIT 1)
  ))`,
}

function orderOf(sort: SearchSort, dir: 'asc' | 'desc', text: TextMatch | null): SQL[] {
  if (sort === 'relevance' && text) {
    return [sql`${contentPosition(text)} ASC NULLS LAST`, desc(relevance(text)), desc(documents.createdAt), asc(documents.id)]
  }
  const column = SORT_COLUMNS[sort === 'relevance' ? 'added' : sort]
  return [dir === 'asc' ? sql`${column} ASC NULLS LAST` : sql`${column} DESC NULLS LAST`, asc(documents.id)]
}

export interface DocumentSearchRow {
  id: string
  filename: string
  displayName: string | null
  scope: string
  projectId: string | null
  projectName: string | null
  folderId: string | null
  folderName: string | null
  folderPath: string
  collectionName: string
  status: string
  contentType: string | null
  createdAt: Date
  createdBy: string
  authoredBy: string
  documentType: string | null
  title: string | null
  planNumber: string | null
  planIndex: string | null
  planDate: string | null
  scale: string | null
  documentDate: string | null
  pageCount: number | null
  pagesNotRead: number | null
  superseded: boolean
  changedFacts: SearchFacetChange[]
  municipality: string | null
  author: string | null
  matchedName: boolean
  matchedReading: boolean
}

export async function searchDocumentPage(
  reach: SearchReach,
  query: DocumentQuery,
  page: { sort: SearchSort; dir: 'asc' | 'desc'; limit: number; offset: number }
): Promise<{ rows: DocumentSearchRow[]; total: number }> {
  const where = documentSearchWhere(reach, query)
  const text = query.text
  const [rows, [{ total }]] = await withTenant({ organizationId: reach.organizationId }, () =>
    Promise.all([
      getDb()
        .select({
        id: documents.id,
        filename: documents.filename,
        displayName: documents.displayName,
        scope: documents.scope,
        projectId: documents.projectId,
        projectName: projects.name,
        folderId: documents.folderId,
        folderName: projectFolders.name,
        folderPath: sql<string>`coalesce(${projectFolders.path}, '')`,
        collectionName: documents.collectionName,
        status: documents.status,
        contentType: documents.contentType,
        createdAt: documents.createdAt,
        createdBy: documents.createdBy,
        authoredBy: documents.authoredBy,
        documentType: f.documentType,
        title: f.title,
        planNumber: f.planNumber,
        planIndex: f.planIndex,
        planDate: f.planDate,
        scale: f.scale,
        documentDate: f.documentDate,
        pageCount: f.pageCount,
        pagesNotRead: f.pagesNotRead,
        superseded: sql<boolean>`coalesce(${f.superseded}, false)`,
        changedFacts: f.changedFacts,
        municipality: f.municipality,
        author: sql<string | null>`coalesce(
          (SELECT party->>'name' FROM jsonb_array_elements(${f.parties}) AS party WHERE party->>'role' = 'architect' LIMIT 1),
          (SELECT party->>'name' FROM jsonb_array_elements(${f.parties}) AS party WHERE party->>'role' = 'author' LIMIT 1)
        )`,
        matchedName: text ? sql<boolean>`coalesce(${nameContains(text.text) ?? sql`false`}, false)` : sql<boolean>`false`,
        matchedReading: text ? sql<boolean>`coalesce(${SEARCH_VECTOR} @@ ${tsQuery(text.text)}, false)` : sql<boolean>`false`,
      })
        .from(documents)
        .leftJoin(f, eq(f.documentId, documents.id))
        .leftJoin(projects, eq(projects.id, documents.projectId))
        .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
        .where(where)
        .orderBy(...orderOf(page.sort, page.dir, text))
        .limit(page.limit)
        .offset(page.offset),
      getDb()
        .select({ total: sql<number>`count(*)` })
        .from(documents)
        .leftJoin(f, eq(f.documentId, documents.id))
        .leftJoin(projects, eq(projects.id, documents.projectId))
        .where(where),
    ])
  )
  return {
    rows: rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
      pageCount: row.pageCount === null ? null : Number(row.pageCount),
      pagesNotRead: row.pagesNotRead === null ? null : Number(row.pagesNotRead),
      planDate: row.planDate === null ? null : String(row.planDate),
      documentDate: row.documentDate === null ? null : String(row.documentDate),
      superseded: Boolean(row.superseded),
      changedFacts: Array.isArray(row.changedFacts) ? row.changedFacts : [],
      matchedName: Boolean(row.matchedName),
      matchedReading: Boolean(row.matchedReading),
    })) as DocumentSearchRow[],
    total: Number(total),
  }
}

export const FACET_VALUES_MAX = 30

const FACET_VALUE: Record<string, SQL> = {
  documentType: sql`${f.documentType}`,
  tag: sql`unnest(${f.tags})`,
  project: sql`${documents.projectId}::text`,
  partyRole: sql`unnest(${f.partyRoles})`,
  municipality: sql`${f.municipality}`,
  cites: sql`unnest(${f.referenceTokens})`,
  status: sql`lower(${documents.status})`,
  uploader: sql`${documents.createdBy}`,
  fileType: sql`CASE WHEN ${documents.filename} ~ '\\.[A-Za-z0-9]{1,8}$' THEN lower(split_part(${documents.filename}, '.', -1)) END`,
  changedFact: sql`unnest(${f.changedFactKeys})`,
}
export type FacetKey = keyof typeof FACET_VALUE

const FACET_ON_MATCHED: Record<FacetKey, SQL> = {
  documentType: sql.raw('matched.document_type'),
  tag: sql.raw('unnest(matched.tags)'),
  project: sql.raw('matched.project_id::text'),
  partyRole: sql.raw('unnest(matched.party_roles)'),
  municipality: sql.raw('matched.municipality'),
  cites: sql.raw('unnest(matched.reference_tokens)'),
  status: sql.raw('lower(matched.status)'),
  uploader: sql.raw('matched.created_by'),
  fileType: sql.raw("CASE WHEN matched.filename ~ '\\.[A-Za-z0-9]{1,8}$' THEN lower(split_part(matched.filename, '.', -1)) END"),
  changedFact: sql.raw('unnest(matched.changed_fact_keys)'),
}

type FacetRows = Record<string, Array<{ value: string; count: number }>>

export async function documentFacetCounts(
  reach: SearchReach,
  query: DocumentQuery,
  keys: readonly FacetKey[]
): Promise<FacetRows> {
  return query.text ? facetCountsOnce(reach, query, keys) : facetCountsSideBySide(reach, query, keys)
}

export async function facetCountsSideBySide(reach: SearchReach, query: DocumentQuery, keys: readonly FacetKey[]): Promise<FacetRows> {
  const where = documentSearchWhere(reach, query)
  const results = await withTenant({ organizationId: reach.organizationId }, () =>
    Promise.all(
      keys.map(async (key) => {
        const value = FACET_VALUE[key]
        const rows = executeRows<{ value: string | null; count: string }>(await getDb().execute(sql`
          SELECT matched.value, count(*) AS count FROM (
            SELECT ${value} AS value
            FROM ${documents}
            LEFT JOIN ${f} ON ${f.documentId} = ${documents.id}
            LEFT JOIN ${projects} ON ${projects.id} = ${documents.projectId}
            WHERE ${where}
          ) AS matched
          WHERE matched.value IS NOT NULL
          GROUP BY matched.value
          ORDER BY count(*) DESC, matched.value
          LIMIT ${FACET_VALUES_MAX}`))
        return [key, rows.map((row) => ({ value: String(row.value), count: Number(row.count) }))] as const
      })
    )
  )
  return Object.fromEntries(results)
}

export async function facetCountsOnce(reach: SearchReach, query: DocumentQuery, keys: readonly FacetKey[]): Promise<FacetRows> {
  if (keys.length === 0) return {}
  const where = documentSearchWhere(reach, query)
  const perFacet = keys.map(
    (key) => sql`SELECT ${key}::text AS facet, value, count(*) AS count
      FROM (SELECT ${FACET_ON_MATCHED[key]} AS value FROM matched) AS v
      WHERE value IS NOT NULL GROUP BY value`
  )
  const rows = executeRows<{ facet: string; value: string; count: string; rank: string }>(
    await withTenant({ organizationId: reach.organizationId }, async () =>
      getDb().execute(sql`
        WITH matched AS MATERIALIZED (
          SELECT ${documents.projectId} AS project_id, ${documents.status} AS status, ${documents.filename} AS filename,
            ${documents.createdBy} AS created_by,
            ${f.documentType} AS document_type, ${f.tags} AS tags, ${f.partyRoles} AS party_roles,
            ${f.municipality} AS municipality, ${f.referenceTokens} AS reference_tokens,
            ${f.changedFactKeys} AS changed_fact_keys
          FROM ${documents}
          LEFT JOIN ${f} ON ${f.documentId} = ${documents.id}
          LEFT JOIN ${projects} ON ${projects.id} = ${documents.projectId}
          WHERE ${where}
        ), counted AS (${sql.join(perFacet, sql` UNION ALL `)})
        SELECT facet, value, count FROM (
          SELECT facet, value, count, row_number() OVER (PARTITION BY facet ORDER BY count DESC, value) AS rank FROM counted
        ) AS ranked
        WHERE rank <= ${FACET_VALUES_MAX}
        ORDER BY facet, rank`)
    )
  )
  const out: FacetRows = Object.fromEntries(keys.map((key) => [key, []]))
  for (const row of rows) out[row.facet]?.push({ value: String(row.value), count: Number(row.count) })
  return out
}

export async function countUnreadDocuments(reach: SearchReach, includeArchived: boolean): Promise<number> {
  const [row] = await withTenant({ organizationId: reach.organizationId }, () =>
    getDb()
      .select({ unread: sql<number>`count(*)` })
      .from(documents)
      .leftJoin(f, eq(f.documentId, documents.id))
      .where(and(reachWhere(reach, includeArchived), ne(documents.scope, 'session'), isNull(f.documentId)))
  )
  return Number(row?.unread ?? 0)
}

export async function readReferenceSubject(
  reach: SearchReach,
  documentId: string
): Promise<{ planNumberKey: string | null; documentType: string | null; referenceTokens: string[] } | null> {
  const [row] = await withTenant({ organizationId: reach.organizationId }, () =>
    getDb()
      .select({ planNumberKey: f.planNumberKey, documentType: f.documentType, referenceTokens: f.referenceTokens })
      .from(documents)
      .leftJoin(f, eq(f.documentId, documents.id))
      .where(and(eq(documents.id, documentId), reachWhere(reach, true)))
      .limit(1)
  )
  if (!row) return null
  return { planNumberKey: row.planNumberKey, documentType: row.documentType, referenceTokens: row.referenceTokens ?? [] }
}

export interface CandidateDocument {
  id: string
  filename: string | null
}

export async function listCandidateDocuments(reach: SearchReach, query: DocumentQuery, max: number): Promise<CandidateDocument[]> {
  const rows = await withTenant({ organizationId: reach.organizationId }, () =>
    getDb()
      .select({
        id: documents.id,
        filename: sql<string | null>`CASE WHEN ${documents.authoredBy} = 'user' THEN ${documents.filename} END`,
      })
      .from(documents)
      .leftJoin(f, eq(f.documentId, documents.id))
      .where(documentSearchWhere(reach, { ...query, text: null }))
      .limit(max + 1)
  )
  return rows.map((row) => ({ id: row.id, filename: row.filename === null ? null : String(row.filename) }))
}
