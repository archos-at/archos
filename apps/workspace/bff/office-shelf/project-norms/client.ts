import {
  placeProjectNormsResponseSchema,
  projectNormsResponseSchema,
  type PlaceProjectNormsBody,
  type PlaceProjectNormsResponse,
  type ProjectNormsResponse,
} from './wire'

export type NormsFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: NormsFetch = (path, init) => fetch(path, init)

export class ProjectNormsRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ProjectNormsRequestError'
  }
}

export const projectNormsPath = (projectId: string, folderId: string | null = null): string =>
  `/api/projects/${encodeURIComponent(projectId)}/norms${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`

async function read(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; detail?: string }
    throw new ProjectNormsRequestError(response.status, error.error ?? error.detail ?? `Request failed with ${response.status}`)
  }
  return body
}

export async function fetchProjectNorms(
  projectId: string,
  folderId: string | null,
  run: NormsFetch = defaultFetch
): Promise<ProjectNormsResponse> {
  return projectNormsResponseSchema.parse(await read(await run(projectNormsPath(projectId, folderId))))
}

export async function placeProjectNorms(
  projectId: string,
  body: PlaceProjectNormsBody,
  run: NormsFetch = defaultFetch
): Promise<PlaceProjectNormsResponse> {
  const response = await run(projectNormsPath(projectId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return placeProjectNormsResponseSchema.parse(await read(response))
}
