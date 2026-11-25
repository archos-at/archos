import { type ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getUserSession } from '@/lib/auth/session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { chatRouteElsewhere } from '@/lib/conversations/chat-route'
import { chatArrivalResumes } from '@/lib/conversations/chat-arrival'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { PersonalChatClient } from './personal-chat-client'

interface PersonalChatPageProps {
  searchParams: Promise<{ session?: string; new?: string }>
}

const PersonalChatPage = async ({ searchParams }: PersonalChatPageProps): Promise<ReactNode> =>
  runWithTenantSlot(async () => {
    const session = await getUserSession().catch(() => null)
    const search = await searchParams
    const conversationId = search.session
    if (conversationId && session?.organizationId && session.organizationMembershipId) {
      const elsewhere = await chatRouteElsewhere(session as AuthorizedSession, conversationId, null)
      if (elsewhere) redirect(elsewhere)
    }
    let canCollaborate = false
    try {
      canCollaborate = session ? isCollaborationEnabled(session) : false
    } catch {
      // Fail open: a session-lookup problem must not hide the chat.
    }
    const arrival = { resumes: await chatArrivalResumes(null, search), greetingName: session?.name ?? null }
    return <PersonalChatClient canCollaborate={canCollaborate} arrival={arrival} />
  })

export default PersonalChatPage
