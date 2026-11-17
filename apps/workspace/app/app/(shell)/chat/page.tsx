import { type ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { requireResourceAccess } from '@/lib/sharing/access'

interface ChatRedirectPageProps {
  searchParams: Promise<{ session?: string }>
}

async function resolveChatTarget(conversationId: string): Promise<string | null> {
  try {
    return await runWithTenantSlot(async () => {
      const session = await requireAuthorizedSession()
      const tenancy = await findConversationTenancy(conversationId)
      if (!tenancy?.projectId) return null
      await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
      return `/app/projects/${encodeURIComponent(tenancy.projectId)}/chat?session=${encodeURIComponent(conversationId)}`
    })
  } catch {
    return null
  }
}

const ChatRedirectPage = async ({ searchParams }: ChatRedirectPageProps): Promise<ReactNode> => {
  const { session } = await searchParams
  const target = session ? await resolveChatTarget(session) : null
  redirect(target ?? '/app/projects')
}

export default ChatRedirectPage
