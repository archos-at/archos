'use client'

import type { JSX } from 'react'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { OrgHeader } from '@/components/shell/org-header'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { installInboxBadgeFake } from '../_fixtures/inbox-badge'
import { installConnectionHealthFake } from '../_fixtures/connection-health'

const PROJECTS = [
  { id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12' },
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
]

installInboxBadgeFake(3)
installConnectionHealthFake()

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  try {
    window.localStorage.setItem('sidebar.collapsed', 'false')
  } catch {
    // Storage unavailable — the rail renders expanded by default anyway.
  }
}

const CHROME_FLAGS = {
  user: { name: 'Anna Berger', email: 'anna.berger@example.at' },
  organizationName: 'Musterarchitektur ZT GmbH',
  authRequired: false,
  canViewOrganization: true,
  canManageOrganization: true,
  canManagePlatform: true,
  canAccessOfficeShelf: true,
  canAccessInbox: true,
} as const

function ScopeColumn({
  caption,
  row,
  tabBar,
  children,
}: {
  caption: string
  row: boolean
  tabBar: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      style={{ transform: 'translateZ(0)' }}
      className={`border-border relative flex h-[50dvh] min-w-0 flex-1 flex-col overflow-hidden border-t first:border-t-0 md:h-dvh md:border-l md:border-t-0 md:first:border-l-0 ${row ? 'md:flex-row' : ''}`}
    >
      {children}
      <main className="bg-background min-h-0 min-w-0 flex-1 overflow-hidden">
        <p className="text-muted-foreground p-6 font-mono text-xs">{caption}</p>
      </main>
      {tabBar}
    </div>
  )
}

export default function AppShellScopesPreview(): JSX.Element {
  return (
    <div
      className="bg-background text-foreground flex h-dvh flex-col md:flex-row"
      data-testid="app-shell-scopes-preview"
    >
      <ScopeColumn
        row
        caption="project scope — /app/projects/p-1/files"
        tabBar={<PhoneTabBar projectId="p-1" canAccessOfficeShelf canAccessInbox pathname="/app/projects/p-1/files" />}
      >
        <AppSidebar projectId="p-1" projects={PROJECTS} showModels showSkills {...CHROME_FLAGS} />
      </ScopeColumn>
      <ScopeColumn
        row={false}
        caption="org scope — /app/projects"
        tabBar={<PhoneTabBar projectId={null} canAccessOfficeShelf canAccessInbox pathname="/app/projects" />}
      >
        <OrgHeader {...CHROME_FLAGS} />
      </ScopeColumn>
    </div>
  )
}
