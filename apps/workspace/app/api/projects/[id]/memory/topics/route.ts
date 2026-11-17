/**
 * The project memory shelf's topics (ADR-0180): rename or merge a topic on the
 * shelf. Only the notes the caller can see and edit move (`renameProjectMemoryTopic`).
 * Thin handler; authz and logic live in `@/lib/projects/service`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { renameProjectMemoryTopic } from '@/lib/projects/service'
import { memoryTopicRenameSchema } from '@/lib/memory-topics/wire'

type Params = { id: string }

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const input = await parseJsonBody(request, memoryTopicRenameSchema)
    return renameProjectMemoryTopic(session, params.id, input)
  },
  { authz: { enforcedBy: 'renameProjectMemoryTopic (requireProjectAccess project:memory:write)' } }
)
