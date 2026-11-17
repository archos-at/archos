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
