import type { UserSession } from '@/lib/auth/types'
import type { ConversationScope } from '@/lib/conversation-context/resolve'
import { encodeCollectionScopeHeader, type ScopedCollection } from '@/lib/retrieval-scope/collection-scope'
import {
  buildRequestContextWireHeaders,
  requesterOf,
  type RequestContextInput,
} from '@/lib/request-context'

export interface AuthorizedJobScope {
  projectId: string | undefined
  scopedCollections: ScopedCollection[]
  verifiedConversationId: string | undefined
  projectReadOnly?: boolean
}

export function jobScopeOf(scope: ConversationScope): AuthorizedJobScope & { headerValue: string } {
  return {
    projectId: scope.projectId ?? undefined,
    scopedCollections: scope.shelves,
    verifiedConversationId: scope.verifiedConversationId ?? undefined,
    projectReadOnly: scope.projectReadOnly,
    headerValue: encodeCollectionScopeHeader(scope.shelves),
  }
}

export type JobSubmitContext = Pick<
  RequestContextInput,
  'modelOverrides' | 'orgInstructions' | 'federalState'
>

export function signJobRequestContext(
  session: UserSession | null,
  scope: AuthorizedJobScope,
  submit: JobSubmitContext = {},
  now: number = Date.now()
): Record<string, string> {
  const signsProject = !scope.projectReadOnly
  const input: RequestContextInput = {
    organizationId: session?.organizationId ?? null,
    userId: session?.userId ?? null,
    projectId: signsProject ? (scope.projectId ?? null) : null,
    collectionScope: signsProject
      ? scope.scopedCollections
      : scope.scopedCollections.filter((entry) => entry.shelf !== 'project'),
    conversationId: scope.verifiedConversationId ?? null,
    issuedAt: now,
    requester: requesterOf(session),
    contextKind: 'run',
    ...submit,
  }
  return buildRequestContextWireHeaders(input, process.env.INTERNAL_API_TOKEN)
}
