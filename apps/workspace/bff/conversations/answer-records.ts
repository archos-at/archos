import 'server-only'
import { recordEditionUses } from '@/lib/base-knowledge/context/edition-uses'
import { markLicensedAnswers } from './licensed-answers'
import type { CreateMessageInput } from './service'

export async function recordPersistedAnswers(
  organizationId: string,
  projectId: string | null,
  conversationId: string,
  inputs: readonly CreateMessageInput[],
  inserted: readonly { id: string }[],
): Promise<void> {
  await markLicensedAnswers(conversationId, inputs, inserted)
  await recordEditionUses(organizationId, projectId, conversationId, inputs)
}
