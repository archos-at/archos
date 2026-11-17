'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { usePathname } from 'next/navigation'

import { ProductTour } from '@/features/onboarding/components/product-tour'
import { FeedbackProvider } from '@/features/product-feedback/components'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { DockedSplit } from '@/components/ui/docked-split'
import { useMediaQuery } from '@/hooks/use-media-query'
import { DOCK_LAYOUT_QUERY } from '@/hooks/use-is-mobile'
import {
  PAGE_INSET_START_VAR,
  PAGE_INSET_TOP_VAR,
  START_DOCK_WIDTH_MAX,
  START_DOCK_WIDTH_MIN,
  defaultStartDockWidth,
  useStartDock,
  type StartDockPanel,
} from './start-dock'
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

const OVERLAY_ROUTES = ['/app/office-shelf', '/app/base-knowledge', '/app/inbox', '/app/uploads'] as const

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
  startDock?: Partial<Record<StartDockPanel, React.ReactNode>>
}

export function AppShellChrome({
  children,
  overlay,
  startDock = {},
  ...chrome
}: AppShellChromeProps): JSX.Element {
  const t = useTranslations(navCopy)
  const pathname = usePathname() ?? ''

  const solidPathRef = React.useRef(isOverlayPath(pathname) ? '/app/projects' : pathname)
  if (!isOverlayPath(pathname)) solidPathRef.current = pathname

  const projectId = projectIdFromPathname(solidPathRef.current)
  const inProject = projectId !== null

  useVisualViewport()

  const dockedPanel = useStartDock((state) => state.panel)
  const dockWidth = useStartDock((state) => state.width)
  const setDockWidth = useStartDock((state) => state.setWidth)
  const restoreDockWidth = useStartDock((state) => state.restoreWidth)
  const closeDock = useStartDock((state) => state.close)
  const restoreDock = useStartDock((state) => state.restore)
  React.useEffect(() => restoreDock(), [restoreDock])
  const [dockSettled, setDockSettled] = React.useState(false)
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setDockSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const dockFits = useMediaQuery(DOCK_LAYOUT_QUERY)
  const dockContent = dockedPanel && dockFits ? (startDock[dockedPanel] ?? null) : null

  const dockFrameRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const frame = dockFrameRef.current
    const root = document.documentElement
    const clear = (): void => {
      root.style.removeProperty(PAGE_INSET_START_VAR)
      root.style.removeProperty(PAGE_INSET_TOP_VAR)
    }
    if (!dockContent || !frame) {
      clear()
      return
    }
    const publish = (): void => {
      const box = frame.getBoundingClientRect()
      root.style.setProperty(PAGE_INSET_START_VAR, `${Math.round(box.right)}px`)
      root.style.setProperty(PAGE_INSET_TOP_VAR, `${Math.round(box.top)}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(frame)
    window.addEventListener('resize', publish)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
      clear()
    }
  }, [dockContent])

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
      {/* Always the same tree: the page is the split's first panel whether or
          not anything is docked, so opening the Postfach never remounts it. */}
      <DockedSplit
        id="start-dock"
        side="start"
        open={dockContent !== null}
        width={dockWidth}
        minWidth={START_DOCK_WIDTH_MIN}
        maxWidth={START_DOCK_WIDTH_MAX}
        defaultWidth={defaultStartDockWidth}
        onWidthChange={setDockWidth}
        onDismiss={closeDock}
        restoreWidth={restoreDockWidth}
        resizeLabel={t('resizeDock')}
        slide={dockSettled}
        panel={dockContent && (
          <div ref={dockFrameRef} className="h-full min-h-0">
            {dockContent}
          </div>
        )}
        panelClassName="border-border bg-surface-sunken border-r"
        pageClassName="flex flex-col"
      >
        {children}
      </DockedSplit>
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
