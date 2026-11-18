'use client'

import type { JSX, ReactNode } from 'react'

import { AppSidebar } from '@/components/shell/app-sidebar'
import { PhoneMoreSheet } from '@/components/shell/phone-more-sheet'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { installConnectionHealthFake } from './connection-health'
import { installInboxBadgeFake } from './inbox-badge'
import { DevRailChats } from './rail-chats'

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
