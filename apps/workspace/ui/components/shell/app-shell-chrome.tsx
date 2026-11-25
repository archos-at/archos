'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { usePathname } from 'next/navigation'

import { ProductTour } from '@/features/onboarding/components/product-tour'
import { FeedbackProvider } from '@/features/product-feedback/components'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { cn } from '@/lib/utils'
import { AppSidebar } from './app-sidebar'
import { useRecordLastPlace } from './last-place'
import { useRecordChatResume } from '@/features/chat/hooks/use-record-chat-resume'
import { PhoneMoreSheet } from './phone-more-sheet'
import { useRailSide, type RailSide } from './rail-side'
import { sideOffRoute, sideOfPath } from './shell-side'
import { PhoneTabBar } from './phone-tab-bar'
import { phoneTabBarHiddenOnRoute } from './phone-tabs'
import { useKeyboardUp } from './use-keyboard-up'
import { ProjectOverviewWindow } from './project-overview-window'
import { shellAccount } from './shell-account'
import type { OverviewProject } from '@/lib/projects/overview-project'
import type { SidebarUser } from './sidebar-user-menu'
import type { TourEligibility } from '@/lib/onboarding/product-tour'
import type { SwitchableOrganization } from '@/lib/organizations/switchable'

const EMPTY_ACTIVITY: Record<string, string> = {}

export interface AppShellChromeProps {
  projects: OverviewProject[]
  projectActivity?: Record<string, string>
  /** What the project overview shows under its projects („Kürzlich gelöscht“). */
  projectOverviewAfter?: React.ReactNode
  user?: SidebarUser
  organizationName?: string | null
  authRequired: boolean
  organizations?: SwitchableOrganization[]
  canManageOrganization: boolean
  canViewOrganization: boolean
  canManagePlatform: boolean
  canAccessOfficeShelf: boolean
  canAccessOfficeStandards?: boolean
  canAccessInbox: boolean
  showSkills: boolean
  showModels: boolean
  inboundMail?: boolean
  tours: TourEligibility
  lastSide?: RailSide
  children: React.ReactNode
  overlay: React.ReactNode
}

export function AppShellChrome({
  children,
  overlay,
  ...chrome
}: AppShellChromeProps): JSX.Element {
  const pathname = usePathname() ?? ''
  useRecordLastPlace(pathname)
  useRecordChatResume()
  const settleSide = useRailSide((state) => state.settle)
  React.useEffect(() => settleSide(), [pathname, settleSide])

  const routeSide = sideOfPath(pathname)
  const [remembered, setRemembered] = React.useState<RailSide | null>(null)
  const routeMode = routeSide?.mode
  const routeProjectId = routeSide?.projectId ?? null
  React.useEffect(() => {
    if (routeMode) setRemembered({ mode: routeMode, projectId: routeProjectId })
  }, [routeMode, routeProjectId])
  const projectIds = React.useMemo(() => chrome.projects.map((project) => project.id), [chrome.projects])
  const side = routeSide ?? sideOffRoute(remembered, chrome.lastSide, projectIds)
  const projectId = side.projectId

  useVisualViewport()
  const account = shellAccount(chrome)

  const keyboardUp = useKeyboardUp()
  const tabBarShown = !keyboardUp && !phoneTabBarHiddenOnRoute(pathname)

  return (
    <ProductTour
      canAccessOfficeShelf={chrome.canAccessOfficeShelf}
      canAccessInbox={chrome.canAccessInbox}
      canManageOrganization={chrome.canManageOrganization}
      eligible={chrome.tours}
    >
    <FeedbackProvider userEmail={chrome.user?.email ?? null}>
    <div
      data-tab-bar={tabBarShown ? 'shown' : 'hidden'}
      data-keyboard={keyboardUp ? 'up' : undefined}
      className={cn(
        'bg-background text-foreground flex h-[var(--visual-viewport-height,100dvh)] overflow-hidden',
        'flex-col md:flex-row',
        '[--shell-inset-bottom:env(safe-area-inset-bottom)] data-[keyboard=up]:[--shell-inset-bottom:0px] max-md:data-[tab-bar=shown]:[--shell-inset-bottom:0px] max-md:[--chat-inset-top:0px]',
      )}
    >
      <AppSidebar
        projectId={projectId}
        onSide={routeSide !== null}
        projects={chrome.projects}
        {...account}
        canAccessOfficeShelf={chrome.canAccessOfficeShelf}
        canAccessOfficeStandards={chrome.canAccessOfficeStandards}
        canAccessInbox={chrome.canAccessInbox}
        showSkills={chrome.showSkills}
        showModels={chrome.showModels}
        inboundMailEnabled={chrome.inboundMail}
      />
      {children}
      {tabBarShown && (
        <PhoneTabBar
          projectId={projectId}
          canAccessOfficeShelf={chrome.canAccessOfficeShelf}
          canAccessInbox={chrome.canAccessInbox}
          inboundMailEnabled={chrome.inboundMail}
        />
      )}
      {tabBarShown && (
        <PhoneMoreSheet
          projectId={projectId}
          projects={chrome.projects}
          projectName={chrome.projects.find((project) => project.id === projectId)?.name ?? null}
          {...account}
          canAccessOfficeShelf={chrome.canAccessOfficeShelf}
          canAccessOfficeStandards={chrome.canAccessOfficeStandards}
          canAccessInbox={chrome.canAccessInbox}
          showSkills={chrome.showSkills}
        />
      )}
      <React.Suspense fallback={null}>
        <ProjectOverviewWindow
          projects={chrome.projects}
          viewerActivity={chrome.projectActivity ?? EMPTY_ACTIVITY}
          after={chrome.projectOverviewAfter}
        />
      </React.Suspense>
      {overlay}
    </div>
    </FeedbackProvider>
    </ProductTour>
  )
}
