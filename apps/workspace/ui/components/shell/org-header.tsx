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


/**
 * The org-scope chrome: one slim header instead of a rail.
 *
 * Above a project there is no section list to navigate — the projects home IS
 * the org scope's content, and everything else up here is either a sheet that
 * floats above it (Archiv, Postfach) or an account destination that already
 * lives in the avatar menu (Profil, Organisation, Plattform). A 236px rail
 * repeating those five links earned its column inside a project and spent it up
 * here, so org scope trades it for a header and gives the page the full width.
 *
 * The header carries exactly what must stay one click away: the wordmark (the
 * way home), the two org-wide doorways with the inbox badge, and the avatar.
 * Someone who works in several offices also gets WorkOS's organization
 * switcher beside the wordmark, since which office they are in is the scope of
 * everything below it.
 * Everything account-shaped is behind the avatar — two clicks, deliberately.
 *
 * On a phone the doorways move to the tab bar at the bottom of the screen
 * (`PhoneTabBar`), where the thumb is, and this band keeps the wordmark, the
 * search that opens the command palette, the avatar, and, while the network is
 * gone, a line that says so (`ConnectionBand`).
 */

export interface OrgHeaderProps {
  user?: SidebarUser
  organizationName?: string | null
  authRequired: boolean
  /** The organizations the avatar menu offers to switch to (`switchableOrganizations`); empty for one. */
  organizations?: readonly SwitchableOrganization[]
  canManageOrganization: boolean
  canViewOrganization: boolean
  canManagePlatform: boolean
  canAccessOfficeShelf: boolean
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
  // The bell opens the Postfach beside the page where it fits.
  const inboxDoor = useStartDockDoor('inbox')
  const tFeedback = useTranslations(feedbackCopy)
  const openFeedback = useOpenFeedback()
  const feedbackAvailable = useFeedbackAvailable()
  const isMobile = useIsMobile()

  return (
    <header
      data-scope="org"
      // No rule under the header, also not while the page scrolls under it: the
      // design system's rule (packages/brand/README.md, „Layout and shape“).
      className="bg-background flex w-full shrink-0 flex-col pt-[env(safe-area-inset-top)]"
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
              active={pathname === '/app/office-shelf' || pathname.startsWith('/app/office-shelf/')}
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
  /** Marks the link as a product-tour stop. */
  tourAnchor?: TourAnchor
  /** A door to a panel docked beside the page (the Postfach). */
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
            // From 1280px the doorway carries its word, as the rail's row does
            // inside a project: an icon alone asked the reader to recall which
            // box was the Büroablage.
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

/** The header's one action that is not a place: the same key shape as a link. */
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
