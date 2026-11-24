import 'server-only'
import { admitPersonalShelf } from '@/lib/conversations/personal-shelf-use'
import { withTenant } from '@/lib/db/tenant-context'
import { admitPersonalShelfForTurn } from '@/lib/documents/personal-shelf-door'
import { personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import type { AgentPrincipal } from './principal'

export async function admitPersonalShelfRead(principal: AgentPrincipal): Promise<boolean> {
  const { organizationId, userId } = principal.session
  const conversationId = principal.conversationId
  if (!conversationId) return false
  const own = personalShelfCollectionName(organizationId, userId)
  const admitted = await withTenant({ organizationId, userId }, () =>
    admitPersonalShelf(
      { organizationId, conversationId, userId, answerMessageId: principal.answerMessageId ?? null },
      [own],
      principal.decision ?? null,
    ),
  )
  if (admitted.length === 0) return false
  admitPersonalShelfForTurn(principal.session)
  return true
}
