'use client'

import type { JSX } from 'react'
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Archive, Bell, FolderKanban, MessageSquarePlus, Search } from 'lucide-react'

import { Logo } from '@/components/brand/logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useInboxBadge } from '@/features/collaboration/hooks/use-inbox'
import { useStartDockDoor, type StartDockDoor } from './start-dock'
import { useFeedbackAvailable, useOpenFeedback } from '@/features/product-feedback/components'
import { InboxBadge } from '@/features/collaboration/components'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import { navCopy } from '@/i18n/namespaces/nav'
import { TOUR_ANCHORS, type TourAnchor } from '@/lib/onboarding/product-tour'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { cn } from '@/lib/utils'
import { BRAND_INSET_ORG, BRAND_ROW } from './brand-slot'
import { ConnectionBand } from './connection-band'
import { ShellSearchButton } from './shell-search-button'
import { SidebarUserMenu, type SidebarUser } from './sidebar-user-menu'
import type { SwitchableOrganization } from '@/lib/organizations/switchable'


export interface OrgHeaderProps {
  user?: SidebarUser
  organizationName?: string | null
  authRequired: boolean
  organizations?: readonly SwitchableOrganization[]
  canManageOrganization: boolean
  canViewOrganization: boolean
  canManagePlatform: boolean
  canAccessOfficeShelf: boolean
  canAccessOfficeStandards?: boolean
  canAccessInbox: boolean
}

export function OrgHeader({
  user,
  organizationName,
  authRequired,
  organizations = [],
  canManageOrganization,
  canViewOrganization,
  canManagePlatform,
  canAccessOfficeShelf,
  canAccessInbox,
}: OrgHeaderProps): JSX.Element {
  const pathname = usePathname() ?? ''
  const t = useTranslations(navCopy)
  const tCollaboration = useTranslations(collaborationCopy)
  const { pending: inboxPending } = useInboxBadge(canAccessInbox)
  const inboxDoor = useStartDockDoor('inbox')
  const tFeedback = useTranslations(feedbackCopy)
  const openFeedback = useOpenFeedback()
  const feedbackAvailable = useFeedbackAvailable()
  const isMobile = useIsMobile()

  return (
    <header
      data-scope="org"
      className="border-border bg-background flex w-full shrink-0 flex-col border-b pt-[env(safe-area-inset-top)]"
    >
      <div className={cn(BRAND_ROW, BRAND_INSET_ORG, 'justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] md:pr-6')}>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/app/projects"
            aria-label={t('allProjects')}
            className="text-foreground rounded-control flex items-center"
          >
            <Logo kind="wordmark" size="small" />
          </Link>
        </div>

        <div className="flex items-center gap-1">
          {/* Where the reader is, as the phone's tab bar lights „Projekte":
              the wordmark goes there too, but says nothing about being there. */}
          <OrgHeaderIconLink
            href="/app/projects"
            label={t('projectSwitcher.projects')}
            icon={FolderKanban}
            active={pathname === '/app/projects'}
          />
          {/* On a phone the two doorways live in the tab bar, under the thumb
              (`PhoneTabBar`), and feedback in the avatar menu; the band keeps
              search and the account. */}
          {canAccessOfficeShelf && (
            <OrgHeaderIconLink
              href="/app/office-shelf"
              label={t('sections.officeShelf')}
              icon={Archive}
              tourAnchor={TOUR_ANCHORS.officeShelf}
              active={pathname === '/app/office-shelf' || pathname.startsWith('/app/office-shelf/') || pathname.startsWith('/app/base-knowledge')}
            />
          )}
          {/* The workspace search (ADR-0136); ⌘K reaches it from anywhere too. */}
          <OrgHeaderIconLink
            href="/app/search"
            label={t('sections.search')}
            icon={Search}
            active={pathname === '/app/search' || pathname.startsWith('/app/search/')}
          />
          {canAccessInbox && (
            <OrgHeaderIconLink
              href="/app/inbox"
              label={tCollaboration('inbox.navLabel')}
              icon={Bell}
              tourAnchor={TOUR_ANCHORS.inbox}
              active={pathname === '/app/inbox' || pathname.startsWith('/app/inbox/')}
              badgeCount={inboxPending}
              door={inboxDoor}
            />
          )}
          {feedbackAvailable && (
            <OrgHeaderIconButton
              label={tFeedback('open')}
              hint={tFeedback('openHint')}
              icon={MessageSquarePlus}
              onClick={() => openFeedback()}
            />
          )}
          <ShellSearchButton className="md:hidden" />
          {/* Space, not a rule, between the doorways and the person. */}
          <div className="hidden w-2 md:block" aria-hidden />
          <SidebarUserMenu
            user={user}
            organizationName={organizationName}
            authRequired={authRequired}
            compact
            menuSide="bottom"
            menuAlign="end"
            avatarSizeClass="size-8"
            canManageOrganization={canManageOrganization}
            canViewOrganization={canViewOrganization}
            canManagePlatform={canManagePlatform}
            organizations={organizations}
            tourAnchor={TOUR_ANCHORS.account}
          />
        </div>
      </div>
      {isMobile && <ConnectionBand />}
    </header>
  )
}

function OrgHeaderIconLink({
  href,
  label,
  icon: Icon,
  active,
  badgeCount = 0,
  tourAnchor,
  door,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  badgeCount?: number
  tourAnchor?: TourAnchor
  door?: StartDockDoor
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          aria-expanded={door?.open}
          data-dock-door={door?.panel}
          onClick={door?.onClick}
          data-tour={tourAnchor}
          className={cn(
            'relative hidden size-9 items-center justify-center gap-2 rounded-control text-[13px] transition-colors pointer-coarse:size-11 md:flex xl:w-auto xl:px-2.5 duration-quick ease-out motion-reduce:transition-none',
            active || door?.open
              ? // On paper, with no track: open is the picked grey, the pointer the desk.
                'bg-selected text-foreground'
              : 'text-muted-foreground hover:bg-desk hover:text-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="hidden xl:inline">{label}</span>
          <InboxBadge
            pending={badgeCount}
            tone="muted"
            className="absolute right-0.5 top-0.5 -translate-y-1/3 translate-x-1/3 xl:static xl:translate-x-0 xl:translate-y-0"
          />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function OrgHeaderIconButton({
  label,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          data-testid="org-header-feedback"
          className="text-muted-foreground hover:bg-desk hover:text-foreground hidden size-9 pointer-coarse:size-11 md:flex items-center justify-center rounded-control transition-colors duration-quick ease-out motion-reduce:transition-none"
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  )
}
