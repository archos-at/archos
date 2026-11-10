/**
 * What the BFF records beside a persisted answer of the backend: the
 * licensed-text mark (`licensed-answers.ts`, ADR-0164) and which edition each
 * answer used at which pack sequences (`message_edition_uses`, ADR-0173).
 * One call from `persistInternalConversationMessages`, so that file does not
 * grow with each record an answer gains.
 */

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
  // From the BFF's own knowledge context, advisory: never costs the answer its row.
  await recordEditionUses(organizationId, projectId, inputs)
}
