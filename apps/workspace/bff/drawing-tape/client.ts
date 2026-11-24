import { measurePath, measureResponseSchema, type MeasureRequest, type MeasureResponse } from './wire'

export type TapeFetch = (path: string, init?: RequestInit) => Promise<Response>

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

export async function measureOnSheet(
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
