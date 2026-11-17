import type { DocumentRole } from '@/lib/project-profile/document-roles'
import { ApiRequestError } from './api-error'

export interface RoleBinding {
  id: string
  documentId: string
  role: DocumentRole
  scopeInstanceId: string | null
  confidence: 'declared' | 'suggested'
  filename: string
  displayName: string | null
}

export interface RoleBindingInput {
  documentId: string
  role: DocumentRole
  scopeInstanceId: string | null
}

export class DocumentRoleRequestError extends ApiRequestError {
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`Failed to bind the document role: ${status}`, status)
    this.name = 'DocumentRoleRequestError'
    this.body = body
  }
}

const rolesPath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/document-roles`

export const listDocumentRoles = async (projectId: string): Promise<RoleBinding[]> => {
  const response = await fetch(rolesPath(projectId))
  if (!response.ok) throw new ApiRequestError(`Failed to list document roles: ${response.status}`, response.status)
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') return []
  const roles = (body as { roles?: unknown }).roles
  return Array.isArray(roles) ? (roles as RoleBinding[]) : []
}

export const bindDocumentRole = async (
  projectId: string,
  binding: RoleBindingInput,
): Promise<{ replaced: RoleBinding[] }> => {
  const response = await fetch(rolesPath(projectId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(binding),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new DocumentRoleRequestError(response.status, body)
  }
  const answer = (await response.json()) as { replaced?: RoleBinding[] }
  return { replaced: answer.replaced ?? [] }
}

export const unbindDocumentRole = async (projectId: string, bindingId: string): Promise<void> => {
  const response = await fetch(`${rolesPath(projectId)}/${encodeURIComponent(bindingId)}`, { method: 'DELETE' })
  if (!response.ok) throw new ApiRequestError(`Failed to unbind the document role: ${response.status}`, response.status)
}
