import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { ApiRequestError } from './api-error'

export const applyProjectProfileFact = async (
  projectId: string,
  key: string,
  value: ProjectPrimitiveValue,
): Promise<void> => {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/profile/patches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch: [{ op: 'add', path: `/facts/${key}`, value }] }),
  })
  if (!response.ok) throw new ApiRequestError(`Failed to apply the profile fact: ${response.status}`, response.status)
}
