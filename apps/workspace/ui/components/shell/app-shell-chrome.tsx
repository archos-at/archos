'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { usePathname } from 'next/navigation'

import { ProductTour } from '@/features/onboarding/components/product-tour'
import { FeedbackProvider } from '@/features/product-feedback/components'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { cn } from '@/lib/utils'
import { AppSidebar } from './app-sidebar'
import { OrgHeader } from './org-header'
import { projectIdFromPathname } from './org-sections'
import { PhoneMoreSheet } from './phone-more-sheet'
import { PhoneTabBar } from './phone-tab-bar'
import { phoneTabBarHiddenOnRoute } from './phone-tabs'
import { useKeyboardUp } from './use-keyboard-up'
import type { ProjectSwitcherProject } from './project-switcher'
import type { SidebarUser } from './sidebar-user-menu'
import type { TourEligibility } from '@/lib/onboarding/product-tour'
import type { SwitchableOrganization } from '@/lib/organizations/switchable'

const OVERLAY_ROUTES = ['/app/office-shelf', '/app/base-knowledge', '/app/uploads'] as const

function isOverlayPath(pathname: string): boolean {
  return OVERLAY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export interface AppShellChromeProps {
  projects: ProjectSwitcherProject[]
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
  children: React.ReactNode
  overlay: React.ReactNode
}

export function AppShellChrome({
  children,
  overlay,
  ...chrome
}: AppShellChromeProps): JSX.Element {
  const pathname = usePathname() ?? ''

  const solidPathRef = React.useRef(isOverlayPath(pathname) ? '/app/projects' : pathname)
  if (!isOverlayPath(pathname)) solidPathRef.current = pathname

  const projectId = projectIdFromPathname(solidPathRef.current)
  const inProject = projectId !== null

  useVisualViewport()

  const keyboardUp = useKeyboardUp()
  const tabBarShown = !keyboardUp && !phoneTabBarHiddenOnRoute(solidPathRef.current)

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
        inProject ? 'flex-col md:flex-row' : 'flex-col',
        '[--shell-inset-bottom:env(safe-area-inset-bottom)] data-[keyboard=up]:[--shell-inset-bottom:0px] max-md:data-[tab-bar=shown]:[--shell-inset-bottom:0px]',
      )}
    >
      {inProject ? (
        <AppSidebar
          projectId={projectId}
          projects={chrome.projects}
          user={chrome.user}
          organizationName={chrome.organizationName}
          authRequired={chrome.authRequired}
          canManageOrganization={chrome.canManageOrganization}
          canViewOrganization={chrome.canViewOrganization}
          canManagePlatform={chrome.canManagePlatform}
          canAccessOfficeShelf={chrome.canAccessOfficeShelf}
          canAccessOfficeStandards={chrome.canAccessOfficeStandards}
          canAccessInbox={chrome.canAccessInbox}
          showSkills={chrome.showSkills}
          showModels={chrome.showModels}
          inboundMailEnabled={chrome.inboundMail}
        />
      ) : (
        <OrgHeader
          user={chrome.user}
          organizationName={chrome.organizationName}
          authRequired={chrome.authRequired}
          organizations={chrome.organizations}
          canManageOrganization={chrome.canManageOrganization}
          canViewOrganization={chrome.canViewOrganization}
          canManagePlatform={chrome.canManagePlatform}
          canAccessOfficeShelf={chrome.canAccessOfficeShelf}
          canAccessOfficeStandards={chrome.canAccessOfficeStandards}
          canAccessInbox={chrome.canAccessInbox}
        />
      )}
      {children}
      {tabBarShown && (
        <PhoneTabBar
          projectId={projectId}
          canAccessOfficeShelf={chrome.canAccessOfficeShelf}
          canAccessInbox={chrome.canAccessInbox}
          inboundMailEnabled={chrome.inboundMail}
        />
      )}
      {inProject && tabBarShown && (
        <PhoneMoreSheet
          projectId={projectId}
          projects={chrome.projects}
          organizationName={chrome.organizationName}
          projectName={chrome.projects.find((project) => project.id === projectId)?.name ?? null}
          user={chrome.user}
          authRequired={chrome.authRequired}
          canAccessOfficeShelf={chrome.canAccessOfficeShelf}
          canAccessOfficeStandards={chrome.canAccessOfficeStandards}
          canAccessInbox={chrome.canAccessInbox}
          showSkills={chrome.showSkills}
          canViewOrganization={chrome.canViewOrganization}
          canManageOrganization={chrome.canManageOrganization}
          canManagePlatform={chrome.canManagePlatform}
        />
      )}
      {overlay}
    </div>
    </FeedbackProvider>
    </ProductTour>
  )
}
