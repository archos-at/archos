'use client'

/**
 * The app shell round a dev preview: the rail at desk width; on a phone the
 * top band, the tab bar and „Mehr“ (with its project selector), as
 * `AppShellChrome` composes them. A preview that takes `?rail=1` wraps its
 * page in this, so the chrome is judged next to a page it borders in the
 * product. A preview cannot be framed in another (gotchas.md, `X-Frame-Options`).
 */

import type { JSX, ReactNode } from 'react'

import { AppSidebar } from '@/components/shell/app-sidebar'
import { PhoneMoreSheet } from '@/components/shell/phone-more-sheet'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { installConnectionHealthFake } from './connection-health'
import { installInboxBadgeFake } from './inbox-badge'
import { DevRailChats } from './rail-chats'

// A count on the Postfach and a healthy connection, so a shot does not depend on load time.
installInboxBadgeFake(3)
installConnectionHealthFake()

const OTHER_PROJECTS = [
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
  { id: 'p-3', name: 'Volksschule Mühlgasse', status: 'paused' as const },
  { id: 'p-4', name: 'Bürohaus Lände 3' },
  { id: 'p-5', name: 'Kindergarten Stammersdorf' },
]

const USER = { name: 'Anna Berger', email: 'anna.berger@example.at' }
const ORGANIZATION = 'Musterarchitektur ZT GmbH'

export function DevRailShell({
  projectId,
  projectName,
  pathname,
  children,
}: {
  projectId: string
  projectName: string
  /** The route the chrome lights. */
  pathname: string
  children: ReactNode
}): JSX.Element {
  const projects = [{ id: projectId, name: projectName }, ...OTHER_PROJECTS]
  return (
    <DevRailChats pathname={pathname}>
    <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row">
      <AppSidebar
        projectId={projectId}
        projects={projects}
        pathname={pathname}
        user={USER}
        organizationName={ORGANIZATION}
        authRequired={false}
        canViewOrganization
        canManageOrganization={false}
        canManagePlatform={false}
        canAccessOfficeShelf
        canAccessOfficeStandards
        canAccessInbox
        showSkills
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      <PhoneTabBar projectId={projectId} canAccessOfficeShelf canAccessInbox pathname={pathname} />
      <PhoneMoreSheet
        projectId={projectId}
        projects={projects}
        projectName={projectName}
        pathname={pathname}
        organizationName={ORGANIZATION}
        user={USER}
        authRequired={false}
        canViewOrganization
        canManageOrganization={false}
        canManagePlatform={false}
        canAccessOfficeShelf
        canAccessOfficeStandards
        canAccessInbox
        showSkills
      />
    </div>
    </DevRailChats>
  )
}
