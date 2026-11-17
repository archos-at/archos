import { getProjectUploadScreening } from './project-upload-screening-client'
import { getUploadScreening } from './upload-screening-client'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'

export class UploadScreeningPolicyUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The upload-screening policy could not be loaded', options)
    this.name = 'UploadScreeningPolicyUnavailableError'
  }
}

const inFlight = new Map<string, Promise<UploadScreeningPolicy>>()

export function loadUploadScreeningPolicy(projectId?: string | null): Promise<UploadScreeningPolicy> {
  const key = projectId ?? ''
  const pending = inFlight.get(key)
  if (pending) return pending
  const read = projectId ? getProjectUploadScreening(projectId) : getUploadScreening()
  const request = read.then(
    (state) => state.policy,
    (cause: unknown) => {
      throw new UploadScreeningPolicyUnavailableError({ cause })
    }
  )
  inFlight.set(key, request)
  const settle = (): void => {
    if (inFlight.get(key) === request) inFlight.delete(key)
  }
  request.then(settle, settle)
  return request
}

export function forgetPendingUploadScreeningPolicyRead(): void {
  inFlight.clear()
}
