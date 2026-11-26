'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { usePathname } from 'next/navigation'

import { ProductTour } from '@/features/onboarding/components/product-tour'
import { FeedbackProvider } from '@/features/product-feedback/components'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { cn } from '@/lib/utils'
import { AppSidebar } from './app-sidebar'
import { PhonePlaceProvider } from './phone-floating-bar'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { useRecordLastPlace } from './last-place'
import { useRailSide, type RailSide } from './rail-side'
import { onSideChat, sideOffRoute, sideOfPath } from './shell-side'
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
  /** The phone menu button's mark: the app layer computes it from the Postfach and the product team's news. */
  phoneMenuMark?: React.ReactNode
}

export function AppShellChrome({
  children,
  overlay,
  ...chrome
}: AppShellChromeProps): JSX.Element {
  const pathname = usePathname() ?? ''
  useRecordLastPlace(pathname)
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

  const onSide = routeSide !== null
  const keyboardUp = useKeyboardUp()
  const phonePage = onSideChat(pathname, projectId, onSide) ? 'chat' : 'page'
  const t = useTranslations(navCopy)
  const placeName =
    side.mode === 'project'
      ? (chrome.projects.find((project) => project.id === projectId)?.name ?? t('railModeProject'))
      : t('railModePersonal')

  return (
    <ProductTour
      canAccessOfficeShelf={chrome.canAccessOfficeShelf}
      canAccessInbox={chrome.canAccessInbox}
      canManageOrganization={chrome.canManageOrganization}
      eligible={chrome.tours}
    >
    <FeedbackProvider userEmail={chrome.user?.email ?? null}>
    <div
      data-phone-page={phonePage}
      data-keyboard={keyboardUp ? 'up' : undefined}
      className={cn(
        'bg-background text-foreground flex h-[var(--visual-viewport-height,100dvh)] overflow-hidden',
        'flex-col md:flex-row',
        '[--shell-inset-bottom:env(safe-area-inset-bottom)] data-[keyboard=up]:[--shell-inset-bottom:0px]',
        '[--phone-top-room:calc(max(0.5rem,env(safe-area-inset-top))+3.5rem)] max-md:data-[phone-page=page]:[--phone-main-top:var(--phone-top-room)]',
      )}
    >
      <PhonePlaceProvider value={placeName}>
      <AppSidebar
        projectId={projectId}
        onSide={onSide}
        projects={chrome.projects}
        {...account}
        canAccessOfficeShelf={chrome.canAccessOfficeShelf}
        canAccessOfficeStandards={chrome.canAccessOfficeStandards}
        canAccessInbox={chrome.canAccessInbox}
        showSkills={chrome.showSkills}
        showModels={chrome.showModels}
        inboundMailEnabled={chrome.inboundMail}
        phoneMenuMark={chrome.phoneMenuMark}
      />
      {children}
      </PhonePlaceProvider>
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
