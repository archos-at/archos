import type { ZodType } from 'zod'
import {
  rootSortRunSchema,
  rootSortSummarySchema,
  type KeptMove,
  type RootSortRunView,
  type RootSortShelf,
  type RootSortSummary,
} from './root-sort-types'

export type RootSortFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: RootSortFetch = (path, init) => fetch(path, init)

export class RootSortRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'RootSortRequestError'
  }
}

export function rootSortPath(shelf: RootSortShelf): string {
  return shelf.kind === 'project'
    ? `/api/projects/${encodeURIComponent(shelf.projectId)}/root-sort`
    : '/api/office-shelf/root-sort'
}

export const rootSortRunPath = (runId: string) => `/api/root-sort-runs/${encodeURIComponent(runId)}`

async function requestAs<T>(
  schema: ZodType<T, unknown>,
  run: RootSortFetch,
  path: string,
  method: 'GET' | 'POST',
  payload?: unknown
): Promise<T> {
  const init: RequestInit =
    payload === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
  const response = await run(path, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string }
    throw new RootSortRequestError(response.status, error.error ?? `Request failed with ${response.status}`)
  }
  return schema.parse(body)
}

export function fetchRootSortSummary(shelf: RootSortShelf, run: RootSortFetch = defaultFetch): Promise<RootSortSummary> {
  return requestAs(rootSortSummarySchema, run, rootSortPath(shelf), 'GET')
}

export function startRootSort(shelf: RootSortShelf, run: RootSortFetch = defaultFetch): Promise<RootSortRunView> {
  return requestAs(rootSortRunSchema, run, rootSortPath(shelf), 'POST')
}

export function fetchRootSortRun(runId: string, run: RootSortFetch = defaultFetch): Promise<RootSortRunView> {
  return requestAs(rootSortRunSchema, run, rootSortRunPath(runId), 'GET')
}

export function applyRootSortRun(
  runId: string,
  keep: readonly KeptMove[],
  run: RootSortFetch = defaultFetch
): Promise<RootSortRunView> {
  return requestAs(rootSortRunSchema, run, `${rootSortRunPath(runId)}/apply`, 'POST', { keep })
}

export function undoRootSortRun(runId: string, run: RootSortFetch = defaultFetch): Promise<RootSortRunView> {
  return requestAs(rootSortRunSchema, run, `${rootSortRunPath(runId)}/undo`, 'POST')
}

export function cancelRootSortRun(runId: string, run: RootSortFetch = defaultFetch): Promise<RootSortRunView> {
  return requestAs(rootSortRunSchema, run, `${rootSortRunPath(runId)}/cancel`, 'POST')
}
