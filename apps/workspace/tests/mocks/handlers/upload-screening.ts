import { http, HttpResponse } from 'msw'
import { SUGGESTED_SCREENING_POLICY, type UploadScreeningPolicy } from '@/lib/upload-screening/policy'

export function projectScreeningBody(policy: UploadScreeningPolicy = SUGGESTED_SCREENING_POLICY) {
  return {
    policy,
    office: policy,
    officeSuggested: policy === SUGGESTED_SCREENING_POLICY,
    override: { addedNameTerms: [], removedNameTerms: [] },
    canManage: false,
  }
}

export const uploadScreeningHandlers = [
  http.get('/api/organization/upload-screening', () =>
    HttpResponse.json({ policy: SUGGESTED_SCREENING_POLICY, suggested: true, suggestion: SUGGESTED_SCREENING_POLICY })
  ),
  http.get('/api/projects/:projectId/upload-screening', () => HttpResponse.json(projectScreeningBody())),
]
