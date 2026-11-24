import type { JSX } from 'react'
import { type ReactNode } from 'react'
import { getUserSession } from '@/lib/auth/session'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { isInboundMailEnabled, isProjectKnowledgePageEnabled, isSkillsEnabled } from '@/lib/authz/feature-flags'
import { getNavFlags } from '@/lib/authz/nav'
import { KeyboardShortcuts } from '@/components/shell'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { PushLifecycle } from '@/features/notifications/components/push-lifecycle'
import { InboxPushOffer } from '@/features/notifications/components/inbox-push-offer'
import { getPushConfig } from '@/lib/push/service'


interface AppLayoutProps {
  children: ReactNode
}

export default async function AppLayout({ children }: AppLayoutProps): Promise<JSX.Element> {
  return runWithTenantSlot(async () => {
    let shortcuts: ReactNode = null
    let notifications: ReactNode = null
    try {
      const session = await getUserSession()
      if (session?.organizationId) {
        const navFlags = await getNavFlags(session)
        const pushEnabled = getPushConfig().enabled
        notifications = (
          <>
            <PushLifecycle enabled={pushEnabled} />
            {pushEnabled && navFlags.canAccessInbox && <InboxPushOffer enabled />}
          </>
        )
        shortcuts = (
          <KeyboardShortcuts
            authRequired={isAuthRequired()}
            canViewOrganization
            showKnowledge={isProjectKnowledgePageEnabled(session)}
            showSkills={isSkillsEnabled(session)}
            canAccessOfficeShelf={navFlags.canAccessOfficeShelf}
            canAccessOfficeStandards={navFlags.canAccessOfficeStandards}
            canCollaborate={navFlags.canCollaborate}
            canAccessInbox={navFlags.canAccessInbox}
            inboundMail={isInboundMailEnabled(session)}
          />
        )
      }
    } catch {
      // shortcuts layer rather than breaking the whole /app subtree.
    }

    return (
      <>
        {children}
        {shortcuts}
        {notifications}
      </>
    )
  })
}
