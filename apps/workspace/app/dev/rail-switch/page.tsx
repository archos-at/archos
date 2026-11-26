'use client'

import type { JSX, MouseEvent } from 'react'
import { Suspense, useEffect, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'

import { AppSidebar } from '@/components/shell/app-sidebar'
import { projectIdFromPathname } from '@/components/shell/org-sections'
import { recordRecentProject } from '@/components/shell/recent-projects'
import { useRailSide } from '@/components/shell/rail-side'
import { useShellOverlays } from '@/components/shell/shell-overlays'
import { I18nProvider } from '@/i18n'
import { installConnectionHealthFake } from '../_fixtures/connection-health'
import { installInboxBadgeFake } from '../_fixtures/inbox-badge'
import { DevRailChats } from '../_fixtures/rail-chats'

installInboxBadgeFake(2)
installConnectionHealthFake()

const PROJECTS = [
  { id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12' },
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
]
const USER = { name: 'Anna Berger', email: 'a.berger@huber-architektur.at' }
const ORGANIZATION = 'Huber Architektur ZT GmbH'
const ROUTE_LOAD_MS = 250

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') recordRecentProject('p-1')

function RailSwitchPreview(): JSX.Element {
  const params = useSearchParams()
  const [path, setPath] = useState(params?.get('path') ?? (params?.get('side') === 'project' ? '/app/projects/p-1/chat' : '/app/personal/chat'))
  const settle = useRailSide((state) => state.settle)
  const setSheetOpen = useShellOverlays((state) => state.setMenuOpen)
  const projectId = projectIdFromPathname(path)
  const navigate = (href: string): void => {
    window.setTimeout(() => setPath(href.split('?')[0]!), ROUTE_LOAD_MS)
  }

  const stayInPreview = (event: MouseEvent): void => {
    const href = (event.target as Element).closest('a')?.getAttribute('href')
    if (!href?.startsWith('/app/')) return
    event.preventDefault()
    navigate(href)
  }

  useEffect(() => settle(), [path, settle])
  useEffect(() => {
    if (params?.get('open') === 'more') setSheetOpen(true)
  }, [params, setSheetOpen])

  return (
    <DevRailChats pathname={path}>
      <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row" data-testid="rail-switch-preview" onClickCapture={stayInPreview}>
        <AppSidebar
          projectId={projectId}
          projects={PROJECTS}
          pathname={path}
          navigateSide={navigate}
          user={USER}
          organizationName={ORGANIZATION}
          authRequired={false}
          canViewOrganization
          canAccessOfficeShelf
          canAccessInbox
          showSkills
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <p key={path} className="text-muted-foreground p-6 font-mono text-xs" data-testid="rail-switch-path">
            {path}
          </p>
        </main>
      </div>
    </DevRailChats>
  )
}

export default function RailSwitchDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Suspense fallback={null}>
        <RailSwitchPreview />
      </Suspense>
    </I18nProvider>
  )
}
