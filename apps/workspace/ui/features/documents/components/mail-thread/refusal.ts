import { ApiRequestError } from '@/adapters/api/api-error'
import { MAIL_THREAD_REFUSALS, type MailThreadRefusal } from '@/lib/mail-thread/mail-thread-wire'

export type MailThreadRefusalKey = MailThreadRefusal | 'project_closed' | 'unknown'

export function refusalKey(error: unknown): MailThreadRefusalKey {
  if (!(error instanceof ApiRequestError)) return 'unknown'
  if (error.reason === 'project-closed') return 'project_closed'
  return (MAIL_THREAD_REFUSALS as readonly string[]).includes(error.reason ?? '') ? (error.reason as MailThreadRefusal) : 'unknown'
}
