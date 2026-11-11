/**
 * The typed client of the person's tape (ADR-0055): the path, the verb and the
 * response shape of `POST /api/documents/{id}/measure`, written once. The
 * review view and the route spec both go through it.
 *
 * No `server-only` and no drizzle: the browser imports this.
 */

import { measurePath, measureResponseSchema, type MeasureRequest, type MeasureResponse } from './wire'

/** How a request is made: `fetch` in a browser, the real handler in a route spec. */
export type TapeFetch = (path: string, init?: RequestInit) => Promise<Response>

/** A request the route refused, with its status and the body's own code. */
export class TapeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'TapeRequestError'
  }
}

/** Ask the engine to measure or snap on a page of the document. */
export async function measureOnDocument(
  documentId: string,
  body: MeasureRequest,
  run: TapeFetch = (path, init) => fetch(path, init)
): Promise<MeasureResponse> {
  const response = await run(measurePath(documentId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (answer ?? {}) as { error?: string; code?: string }
    throw new TapeRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`
    )
  }
  return measureResponseSchema.parse(answer)
}
