import { z } from 'zod'
import {
  REGION_OVERLAPS,
  calibrationListResponseSchema,
  calibrationViewSchema,
  type CalibrationListResponse,
  type CalibrationView,
  type SetCalibrationRequest,
} from './wire'

export type CalibrationFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: CalibrationFetch = (path, init) => fetch(path, init)

export class CalibrationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly overlapping: string | null = null
  ) {
    super(message)
    this.name = 'CalibrationRequestError'
  }
}

export const regionOverlap = (error: unknown): { overlapping: string | null } | null =>
  error instanceof CalibrationRequestError && error.code === REGION_OVERLAPS ? { overlapping: error.overlapping } : null

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
    const error = (body ?? {}) as { error?: string; code?: string; overlapping?: unknown; details?: { overlapping?: unknown } }
    const overlapping = error.overlapping ?? error.details?.overlapping
    throw new CalibrationRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`,
      typeof overlapping === 'string' ? overlapping : null
    )
  }
  return parse(body)
}

export const calibrationsPath = (documentId: string) =>
  `/api/documents/${encodeURIComponent(documentId)}/calibrations`

const LIST_PAGES_MAX = 5

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
