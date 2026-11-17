'use client'

import type { JSX } from 'react'
import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { PhoneMoreSheet } from '@/components/shell/phone-more-sheet'
import { recordRecentProject } from '@/components/shell/recent-projects'
import { useShellOverlays } from '@/components/shell/shell-overlays'
import { installConnectionHealthFake } from '../_fixtures/connection-health'
import { installInboxBadgeFake } from '../_fixtures/inbox-badge'
import { DevRailChats } from '../_fixtures/rail-chats'

const SIDEBAR_STORAGE_KEY = 'sidebar.collapsed'
const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebar.width'
const WIDE_WIDTH = 400

installInboxBadgeFake(3)
installConnectionHealthFake()

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  try {
    const variant = new URLSearchParams(window.location.search).get('variant')
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(variant === 'collapsed'))
    if (variant === 'wide') window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(WIDE_WIDTH))
    else window.localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
  } catch {
    // still renders a valid (if off-variant) preview rather than nothing.
  }
}

const PROJECTS = [
  { id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12' },
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
  { id: 'p-3', name: 'Volksschule Mühlgasse', status: 'paused' as const },
  { id: 'p-4', name: 'Bürohaus Lände 3' },
  { id: 'p-5', name: 'Kindergarten Stammersdorf' },
  { id: 'p-6', name: 'Dachausbau Kaiserstraße 12' },
]

const ACTIVE_PATHS: Record<string, string> = {
  chat: '/app/projects/p-1/chat/t-1',
  files: '/app/projects/p-1/files',
  automation: '/app/projects/p-1/automation',
  settings: '/app/projects/p-1/settings',
  officeShelf: '/app/office-shelf',
  search: '/app/search',
  inbox: '/app/inbox',
}


if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  recordRecentProject('p-4')
  recordRecentProject('p-2')
  recordRecentProject('p-1')
}

export default function AppRailPreview(): JSX.Element {
  const params = useSearchParams()
  const variant = params?.get('variant') ?? 'default'
  const open = params?.get('open')
  const viewer = params?.get('gates') === 'viewer'
  const previewPath = ACTIVE_PATHS[params?.get('active') ?? 'files'] ?? ACTIVE_PATHS.files!
  const setSheetOpen = useShellOverlays((s) => s.setMoreSheetOpen)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (open === 'switcher' || open === 'more') setSheetOpen(true)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [open, setSheetOpen])

  return (
    <DevRailChats pathname={previewPath} empty={params?.get('chats') === 'empty'}>
    <div
      className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row"
      data-testid="app-rail-preview"
      data-variant={variant}
    >
      {/* `contents` keeps the rail a direct flex child of the shell row, the
          way the shell hosts it: the desktop rail at `md`, the phone's top band
          below. */}
      <div className="contents">
        <AppSidebar
          projectId="p-1"
          projects={PROJECTS}
          pathname={previewPath}
          user={{ name: 'Anna Berger', email: 'anna.berger@example.at' }}
          organizationName="Musterarchitektur ZT GmbH"
          authRequired={false}
          canViewOrganization={!viewer}
          canManageOrganization={!viewer}
          canManagePlatform={!viewer}
          canAccessOfficeShelf={!viewer}
          canAccessOfficeStandards={!viewer}
          canAccessInbox
          showModels
          showSkills={!viewer}
        />
      </div>

      {/* Content stand-in: the rail is the subject, but it is only honest to
          judge its edge against the surface it actually borders. */}
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden p-6">
        <p className="text-muted-foreground font-mono text-xs">
          /dev/app-rail —{' '}
          {variant === 'collapsed'
            ? 'collapsed icon rail (64px)'
            : variant === 'wide'
              ? `rail dragged to ${WIDE_WIDTH}px`
              : 'expanded rail (272px)'}
          <span className="md:hidden"> · phone: tab bar lit for {previewPath}</span>
        </p>
      </main>
      <PhoneTabBar projectId="p-1" canAccessOfficeShelf canAccessInbox pathname={previewPath} />
      <PhoneMoreSheet
        projectId="p-1"
        projects={PROJECTS}
        projectName={PROJECTS[0]!.name}
        initialView={open === 'switcher' ? 'projects' : 'more'}
        pathname={previewPath}
        organizationName="Musterarchitektur ZT GmbH"
        user={{ name: 'Anna Berger', email: 'anna.berger@example.at' }}
        authRequired={false}
        canAccessOfficeShelf
        canAccessInbox
        showSkills
        canViewOrganization
        canManageOrganization={false}
        canManagePlatform={false}
      />
    </div>
    </DevRailChats>
  )
}
