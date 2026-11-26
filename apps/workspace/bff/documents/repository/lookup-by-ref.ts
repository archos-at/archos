import 'server-only'
import { and, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { splitDocumentName } from '../display-name'
import { nextFreeDocumentName } from '../name-conflict'
import { documentNameMatchKey, holdsDocumentName } from '../name-match'
import { documents, type Document, type DocumentAuthor } from '@/lib/db/schema/documents'
import type { DocumentScreeningOutcome } from '@/lib/db/schema/documents'
import { documentVisibleTo, internalRead } from '../visibility'
import { DOCUMENT_LIST_LIMIT } from './list'

export async function findDocumentAuthoredByRef(
  ref: string,
  organizationId: string,
  projectId: string,
  producer: string,
): Promise<Pick<Document, 'id' | 'filename' | 'folderId'> | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        folderId: documents.folderId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.authoredByRef, ref),
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
          eq(documents.authoredByProducer, producer),
          ne(documents.authoredBy, 'user'),
          documentVisibleTo(internalRead('identity')),
        ),
      )
      .limit(1),
  )
  return rows[0] ?? null
}

export type DocumentNamePlace =
  | { readonly folderId: string; readonly collectionName?: string }
  | { readonly folderId: null; readonly collectionName: string }

function inPlace(place: DocumentNamePlace): SQL[] {
  return [
    place.folderId === null ? isNull(documents.folderId) : eq(documents.folderId, place.folderId),
    ...(place.collectionName === undefined ? [] : [eq(documents.collectionName, place.collectionName)]),
  ]
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (character) => `\\${character}`)

function asciiLikePattern(text: string): string {
  return [...text].map((character) => (character.charCodeAt(0) < 0x80 ? escapeLike(character) : '_')).join('')
}

function nameKeyLike(column: typeof documents.filename | typeof documents.displayName, pattern: string): SQL {
  return sql`lower(normalize(btrim(${column}), NFC)) LIKE ${pattern} ESCAPE '\\'`
}

function mayHoldName(pattern: string): SQL {
  return sql`(${nameKeyLike(documents.filename, pattern)} OR ${nameKeyLike(documents.displayName, pattern)})`
}

export interface LiveDocumentNameHolder {
  id: string
  filename: string
  displayName: string | null
  storageKey: string
  storageBucket: string | null
  fileSize: number | null
  contentHash: string | null
  folderId: string | null
  status: string
  authoredBy: DocumentAuthor
  screeningOutcome: DocumentScreeningOutcome | null
  screenedHash: string | null
  createdBy: string
  scope: Document['scope']
  projectId: string | null
}

export async function findLiveDocumentByFilename(
  organizationId: string,
  place: DocumentNamePlace,
  name: string,
  { excluding }: { excluding?: string } = {},
): Promise<LiveDocumentNameHolder | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        displayName: documents.displayName,
        storageKey: documents.storageKey,
        storageBucket: documents.storageBucket,
        fileSize: documents.fileSize,
        contentHash: documents.contentHash,
        folderId: documents.folderId,
        status: documents.status,
        authoredBy: documents.authoredBy,
        screeningOutcome: documents.screeningOutcome,
        screenedHash: documents.screenedHash,
        createdBy: documents.createdBy,
        scope: documents.scope,
        projectId: documents.projectId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          ...inPlace(place),
          mayHoldName(asciiLikePattern(documentNameMatchKey(name))),
          eq(documents.authoredBy, 'user'),
          ...(excluding ? [ne(documents.id, excluding)] : []),
          documentVisibleTo(internalRead('identity')),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(DOCUMENT_LIST_LIMIT),
  )
  return rows.find((row) => holdsDocumentName(row, name)) ?? null
}

export async function findTakenDocumentNameKeys(
  organizationId: string,
  place: DocumentNamePlace,
  name: string,
): Promise<Set<string>> {
  const { stem, extension } = splitDocumentName(documentNameMatchKey(name))
  const family = `${asciiLikePattern(stem)} %${asciiLikePattern(extension)}`
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ filename: documents.filename, displayName: documents.displayName })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          ...inPlace(place),
          mayHoldName(family),
          documentVisibleTo(internalRead('identity')),
        ),
      ),
  )
  const keys = new Set([documentNameMatchKey(name)])
  for (const row of rows) {
    keys.add(documentNameMatchKey(row.filename))
    if (row.displayName) keys.add(documentNameMatchKey(row.displayName))
  }
  return keys
}

export async function findFreeDocumentName(organizationId: string, place: DocumentNamePlace, name: string): Promise<string> {
  return nextFreeDocumentName(name, await findTakenDocumentNameKeys(organizationId, place, name))
}
