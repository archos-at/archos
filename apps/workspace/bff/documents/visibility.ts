import 'server-only'
import { and, eq, inArray, isNotNull, isNull, ne, not, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { documents } from '@/lib/db/schema/documents'
import { IN_FLIGHT_DOCUMENT_STATUSES, columnStatuses } from './document-status'
import {
  SCREENING_PASSED_OUTCOMES,
  UNSCREENED_SETTLED_STATUSES,
  type DocumentReader,
  type ShelfReader,
} from './document-reader'

export {
  internalRead,
  memberReader,
  REVIEWER_READER,
  SCREENED_ONLY,
  type DocumentReader,
  type InternalDocumentRead,
  type ShelfReader,
} from './document-reader'

function passedScreening(): SQL {
  return and(
    ne(documents.status, 'quarantined'),
    or(
      ne(documents.authoredBy, 'user'),
      and(
        sql`${documents.screenedHash} IS NOT DISTINCT FROM ${documents.contentHash}`,
        or(
          and(isNotNull(documents.screeningOutcome), inArray(documents.screeningOutcome, [...SCREENING_PASSED_OUTCOMES])),
          and(isNull(documents.screeningOutcome), inArray(documents.status, [...UNSCREENED_SETTLED_STATUSES])),
        ),
      ),
    ),
  ) as SQL
}

export function heldAtRest(): SQL {
  return and(not(passedScreening()), notInArray(documents.status, columnStatuses(IN_FLIGHT_DOCUMENT_STATUSES))) as SQL
}

function heldRowFor(reader: ShelfReader): SQL {
  return reader.kind === 'reviewer' ? sql`true` : eq(documents.createdBy, reader.userId)
}

export function documentVisibleTo(reader: DocumentReader): SQL | undefined {
  switch (reader.kind) {
    case 'internal':
    case 'reviewer':
      return undefined
    case 'member':
      return or(passedScreening(), heldRowFor(reader))
    case 'shelves':
      return or(
        passedScreening(),
        and(eq(documents.scope, 'project'), heldRowFor(reader.project)),
        and(eq(documents.scope, 'office_shelf'), heldRowFor(reader.officeShelf)),
      )
    case 'projects':
      return or(
        passedScreening(),
        eq(documents.createdBy, reader.userId),
        ...(reader.reviewedProjectIds.length > 0
          ? [and(eq(documents.scope, 'project'), inArray(documents.projectId, [...reader.reviewedProjectIds]))]
          : []),
        ...(reader.reviewsOfficeShelf ? [eq(documents.scope, 'office_shelf')] : []),
      )
    case 'screened-only':
      return passedScreening()
  }
}
