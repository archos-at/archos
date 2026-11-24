import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BackLink, ShellContent } from '@/components/shell'
import { InboxWorkspace } from '@/features/collaboration/components'
import { NotificationPrompt } from '@/features/notifications/components/notification-prompt'
import { getTranslations } from '@/i18n/server'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { withPageSession } from '@/lib/auth/require-auth'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { inboxIsReachable } from '@/lib/inbox/registry'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(collaborationCopy)
  return { title: t('inbox.title') }
}

export default async function InboxPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    if (!inboxIsReachable(isCollaborationEnabled(session))) notFound()
    const t = await getTranslations(collaborationCopy)
    return (
      <ShellContent width="tool" fill>
        <div className="listing-container flex h-full min-h-0 flex-col">
          <InboxWorkspace
            viewerId={session.userId}
            offer={<NotificationPrompt />}
            title={t('inbox.title')}
            back={<BackLink fallbackHref="/app/projects" fallbackLabel={t('inbox.page.back')} className="self-start" />}
          />
        </div>
      </ShellContent>
    )
  })
}
