import {
  intakeDecisionsResponseSchema,
  intakeResponseSchema,
  type IntakeDecision,
  type IntakeDecisionResult,
  type IntakeView,
  type StartIntakeRequest,
} from './types'

export type ProjectIntakeFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: ProjectIntakeFetch = (path, init) => fetch(path, init)

export class ProjectIntakeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly reason: string | null = null
  ) {
    super(message)
    this.name = 'ProjectIntakeRequestError'
  }
}

export const projectIntakePath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/intake`

export interface ProjectIntakeClient {
  get(projectId: string): Promise<IntakeView>
  start(projectId: string, body: StartIntakeRequest): Promise<IntakeView>
  decide(projectId: string, decisions: IntakeDecision[]): Promise<{ results: IntakeDecisionResult[]; intake: IntakeView }>
  complete(projectId: string): Promise<IntakeView>
}

async function send(run: ProjectIntakeFetch, path: string, method: 'GET' | 'POST', payload?: unknown): Promise<unknown> {
  const init: RequestInit =
    payload === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
  const response = await run(path, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string; details?: { reason?: unknown } }
    const reason = typeof error.details?.reason === 'string' ? error.details.reason : null
    throw new ProjectIntakeRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`,
      reason
    )
  }
  return body
}

export function createProjectIntakeClient(fetchImpl: ProjectIntakeFetch = defaultFetch): ProjectIntakeClient {
  const view = async (path: string, method: 'GET' | 'POST', payload?: unknown) =>
    intakeResponseSchema.parse(await send(fetchImpl, path, method, payload)).intake
  return {
    get: (projectId) => view(projectIntakePath(projectId), 'GET'),
    start: (projectId, body) => view(projectIntakePath(projectId), 'POST', body),
    decide: async (projectId, decisions) =>
      intakeDecisionsResponseSchema.parse(
        await send(fetchImpl, `${projectIntakePath(projectId)}/decisions`, 'POST', { decisions })
      ),
    complete: (projectId) => view(`${projectIntakePath(projectId)}/complete`, 'POST'),
  }
}
