import 'server-only'

import { findOpenJobId } from '@/lib/jobs-queue/repository'

export const SUGGESTION_WAIT_MS = 30_000
export const SUGGESTION_MAX_WAITS = 10

export async function suggestionPending(organizationId: string, mailId: string): Promise<boolean> {
  return (await findOpenJobId({ kind: 'inbound_mail_suggest', organizationId, matching: { mailId } })) !== null
}
