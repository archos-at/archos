/**
 * The typed client for a drawing's calibrations (ADR-0055, ADR-0183): the
 * paths, the verbs and the response shapes, written once. Responses are parsed
 * with the schemas of `./wire`, never cast.
 *
 * No `server-only`: the review view imports this.
 */
import { z } from 'zod'
import {
  calibrationListResponseSchema,
  calibrationViewSchema,
  type CalibrationListResponse,
  type CalibrationView,
  type SetCalibrationRequest,
} from './wire'

/** How a request is made: `fetch` in a browser, a stand-in in a spec. */
export type CalibrationFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: CalibrationFetch = (path, init) => fetch(path, init)

/** A request the API refused, with its status and the body's own code (`feature_disabled` where the feature is off). */
export class CalibrationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'CalibrationRequestError'
  }
}

const calibrationResponseSchema = z.object({ calibration: calibrationViewSchema })

async function request<T>(
  run: CalibrationFetch,
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T
): Promise<T> {
  const response = await run(path, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string }
    throw new CalibrationRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`
    )
  }
  return parse(body)
}

export const calibrationsPath = (documentId: string) =>
  `/api/documents/${encodeURIComponent(documentId)}/calibrations`

/** How many pages of the list a read follows: a page of a drawing holds a handful of regions, not hundreds. */
const LIST_PAGES_MAX = 5

/**
 * The active calibrations of a document's current version, every page of it or
 * one. Follows the cursor for a bounded number of pages.
 */
export async function listActiveCalibrations(
  documentId: string,
  options: { page?: number; run?: CalibrationFetch } = {}
): Promise<CalibrationListResponse> {
  const run = options.run ?? defaultFetch
  const calibrations: CalibrationView[] = []
  let cursor: string | null = null
  let last: CalibrationListResponse | null = null
  for (let read = 0; read < LIST_PAGES_MAX; read += 1) {
    const query = new URLSearchParams({ status: 'active' })
    if (options.page !== undefined) query.set('page', String(options.page))
    if (cursor) query.set('cursor', cursor)
    last = await request(run, `${calibrationsPath(documentId)}?${query.toString()}`, { method: 'GET' }, (value) =>
      calibrationListResponseSchema.parse(value)
    )
    calibrations.push(...last.calibrations)
    cursor = last.nextCursor
    if (!cursor) break
  }
  return { calibrations, nextCursor: cursor, versionId: last?.versionId ?? null, canCalibrate: last?.canCalibrate ?? false }
}

/** Sets a calibration: two points, their true length and the region it holds for, all as shares of the page. */
export async function setCalibration(
  documentId: string,
  input: SetCalibrationRequest,
  options: { run?: CalibrationFetch } = {}
): Promise<CalibrationView> {
  const result = await request(
    options.run ?? defaultFetch,
    calibrationsPath(documentId),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    (value) => calibrationResponseSchema.parse(value)
  )
  return result.calibration
}

/** Withdraws a calibration. What it superseded stays superseded. */
export async function withdrawCalibration(
  documentId: string,
  calibrationId: string,
  options: { run?: CalibrationFetch } = {}
): Promise<CalibrationView> {
  const result = await request(
    options.run ?? defaultFetch,
    `${calibrationsPath(documentId)}/${encodeURIComponent(calibrationId)}/withdraw`,
    { method: 'POST' },
    (value) => calibrationResponseSchema.parse(value)
  )
  return result.calibration
}

/** The three calls the review view makes, as one object a preview or a spec can stand in for. */
export interface CalibrationClient {
  list: (documentId: string) => Promise<CalibrationListResponse>
  set: (documentId: string, input: SetCalibrationRequest) => Promise<CalibrationView>
  withdraw: (documentId: string, calibrationId: string) => Promise<CalibrationView>
}

export const calibrationClient: CalibrationClient = {
  list: (documentId) => listActiveCalibrations(documentId),
  set: (documentId, input) => setCalibration(documentId, input),
  withdraw: (documentId, calibrationId) => withdrawCalibration(documentId, calibrationId),
}
