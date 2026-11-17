import { compareRevisionHref } from './revision-compare-link'
import {
  clearReviewParams,
  DOC_PARAM,
  hrefWithParams,
  setReviewParams,
  type ReviewLocation,
  type ReviewTarget,
} from './open-review'

const addresses = (location: Pick<ReviewLocation, 'search'>, documentId: string): boolean =>
  new URLSearchParams(location.search).get(DOC_PARAM) === documentId

export function otherReviewHref(
  location: Pick<ReviewLocation, 'pathname' | 'search'>,
  shownDocumentId: string,
  target: ReviewTarget
): string | null {
  if (!addresses(location, shownDocumentId)) return null
  return hrefWithParams(location.pathname, setReviewParams(new URLSearchParams(location.search), target, { withDocument: true }))
}

export function compareFromReviewHref(
  location: Pick<ReviewLocation, 'pathname' | 'search'>,
  shownDocumentId: string,
  olderId: string
): string | null {
  if (!addresses(location, shownDocumentId)) return null
  return compareRevisionHref(hrefWithParams(location.pathname, clearReviewParams(new URLSearchParams(location.search))), olderId)
}
