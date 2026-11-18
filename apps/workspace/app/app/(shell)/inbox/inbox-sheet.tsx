import type { JSX } from 'react'
import { notFound } from 'next/navigation'

import { withPageSession } from '@/lib/auth/require-auth'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { inboxIsReachable } from '@/lib/inbox/registry'
import { getTranslations } from '@/i18n/server'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { commonCopy } from '@/i18n/namespaces/common'
import { RoutePageSheet } from '@/components/shell/route-page-sheet'
import { InboxList } from '@/features/collaboration/components'

export async function InboxSheet({ standalone }: { standalone: boolean }): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    if (!inboxIsReachable(isCollaborationEnabled(session))) {
      notFound()
    }

    const t = await getTranslations(collaborationCopy)
    const tCommon = await getTranslations(commonCopy)

    return (
      <RoutePageSheet
        title={t('inbox.title')}
        subtitle={t('inbox.subtitle')}
        closeLabel={tCommon('actions.close')}
        standalone={standalone}
        bodyClassName="overflow-y-auto"
      >
        {/* The list caps its own width: a flat list keeps a reading measure,
            the queue takes the room its detail needs beside it. */}
        {/* The sheet reaches the screen's edge, so the last row ends above the home
            indicator instead of under it. */}
        <div className="w-full px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 md:px-8">
          <InboxList viewerId={session.userId} />
        </div>
      </RoutePageSheet>
    )
  })
}
