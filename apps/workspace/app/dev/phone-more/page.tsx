'use client'

/**
 * Dev preview for „Mehr" on a phone: the tab bar with its bottom sheet open, as
 * a tap on „Mehr" leaves it. `?scope=org` shows the destinations above a
 * project (the org bar has no „Mehr" tab; the sheet's list is what an org
 * reader would be offered). Inside a project the sheet's first row is the
 * project selector. 404s outside development.
 */

import type { JSX } from 'react'
import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { notFound } from 'next/navigation'
import { FeedbackProvider } from '@/features/product-feedback/components'
import { PhoneMoreSheet } from '@/components/shell/phone-more-sheet'
import { feedbackPreviewApi } from '../_fixtures/feedback-threads'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { useShellOverlays } from '@/components/shell/shell-overlays'

export default function PhoneMoreDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  const org = useSearchParams()?.get('scope') === 'org'
  const projectId = org ? null : 'demo'
  const pathname = org ? '/app/projects' : '/app/projects/demo/settings/members'
  const setOpen = useShellOverlays((s) => s.setMoreSheetOpen)
  useEffect(() => setOpen(true), [setOpen])
  // The shell's feedback provider with the fake backend: „Mein Feedback" shows
  // with its count, the tab its dot, and a tap hands over to the real modal.
  const threadsApi = useMemo(() => feedbackPreviewApi('list'), [])
  return (
    <FeedbackProvider threadsApi={threadsApi}>
    <div className="bg-background flex h-dvh flex-col">
      <div className="flex h-14 shrink-0 items-center border-b px-4 text-lg font-medium">Kaiserstraße 43</div>
      <main className="text-muted-foreground min-h-0 flex-1 p-4 text-sm">Page content</main>
      <PhoneTabBar projectId={projectId} canAccessOfficeShelf canAccessInbox pathname={pathname} />
      <PhoneMoreSheet
        projectId={projectId}
        pathname={pathname}
        organizationName="Musterarchitektur ZT GmbH"
        projectName="Wohnbau Seestadt Baufeld D12"
        projects={[
          { id: 'demo', name: 'Wohnbau Seestadt Baufeld D12' },
          { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
          { id: 'p-4', name: 'Bürohaus Lände 3' },
          { id: 'p-3', name: 'Volksschule Mühlgasse', status: 'paused' },
        ]}
        user={{ name: 'Anna Berger', email: 'anna.berger@example.at' }}
        authRequired
        canAccessOfficeShelf
        canAccessInbox
        showSkills
        canViewOrganization
        canManageOrganization
        canManagePlatform
      />
    </div>
    </FeedbackProvider>
  )
}
