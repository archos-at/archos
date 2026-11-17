import { isZdrPolicyRefusal } from '@/lib/model-config/zdr-refusal'
import type { ErrorCode } from '../types'

export { isZdrPolicyRefusal }

const RUN_ERROR_CODES: Record<string, ErrorCode> = {
  workflow_error: 'agent.workflow_error',
  auth_error: 'auth.session_expired',
  interaction_expired: 'agent.response_interrupted',
}

export interface RunErrorCard {
  code: ErrorCode
  message?: string
  details?: string
}

export function runErrorCard(error: { code: string; message: string } | undefined): RunErrorCard {
  if (!error) return { code: 'agent.response_failed' }
  if (isZdrPolicyRefusal(error.message)) return { code: 'agent.zdr_refused', details: error.message }
  return { code: RUN_ERROR_CODES[error.code] ?? 'agent.response_failed', message: error.message }
}
