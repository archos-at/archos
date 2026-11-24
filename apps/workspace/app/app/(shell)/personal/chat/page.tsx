import { type ReactNode } from 'react'
import { getUserSession } from '@/lib/auth/session'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { PersonalChatClient } from './personal-chat-client'

const PersonalChatPage = async (): Promise<ReactNode> =>
  runWithTenantSlot(async () => {
    let canCollaborate = false
    try {
      const session = await getUserSession()
      canCollaborate = session ? isCollaborationEnabled(session) : false
    } catch {
      // Fail open: a session-lookup problem must not hide the chat.
    }
    return <PersonalChatClient canCollaborate={canCollaborate} />
  })

export default PersonalChatPage
