'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { motion, springGlide } from '@/components/motion'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { navCopy } from '@/i18n/namespaces/nav'
import { pruneProjectSections, useRecordProjectSection } from '@/hooks/use-last-project-section'
import { InboundMailWaitingBadge } from './inbound-mail-waiting-badge'
import { useInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { useInboxBadge } from '@/features/collaboration/hooks/use-inbox'
import { useStartDockDoor, type StartDockDoor } from './start-dock'
import { InboxBadge } from '@/features/collaboration/components'
import { cn } from '@/lib/utils'
import { SidebarBrand } from './sidebar-brand'
import { ProjectSwitcher, type ProjectSwitcherProject } from './project-switcher'
import { SidebarUserMenu, type SidebarUser } from './sidebar-user-menu'
import {
  PROJECT_SETTINGS_SECTION,
  railGroups,
  sectionHref,
  sectionLinkHref,
  type ProjectNavGroup,
  type ProjectSection,
} from './project-sections'
import { phoneBackTarget } from './phone-tabs'
import { framesProjectPage } from './project-section-frame'
import { useRecordRecentProject } from './recent-projects'
import { ShellSearchButton } from './shell-search-button'
import { RailChatList, useRailChats } from './rail-chats'
import { ConnectionBand } from './connection-band'
import { ShortcutKeys } from './shortcut-keys'
import { LEADER_KEY } from './shortcuts'
import { sectionAnchor } from '@/lib/onboarding/product-tour'

export function railActivePillId(iconRail: boolean): string {
  return `rail-active-project-${iconRail ? 'icon' : 'full'}`
}

export interface AppSidebarProps {
  projectId: string
  projects: ProjectSwitcherProject[]
  user?: SidebarUser
  organizationName?: string | null
  authRequired: boolean
  canManageOrganization?: boolean
  canViewOrganization?: boolean
  canManagePlatform?: boolean
  canAccessOfficeShelf?: boolean
  canAccessOfficeStandards?: boolean
  showModels?: boolean
  showSkills?: boolean
  canAccessInbox: boolean
  inboundMailEnabled?: boolean
  pathname?: string
}

interface RailItemModel {
  key: string
  href: string
  icon: ProjectSection['icon']
  label: string
  active: boolean
  within?: boolean
  badgeCount: number
  door?: StartDockDoor
  waitingCount: number | null
  shortcutKey?: string
}

interface RailGroupModel {
  key: ProjectNavGroup
  label: string
  items: RailItemModel[]
}

function sectionLabel(
  item: ProjectSection,
  t: (key: string) => string,
  tCollaboration: (key: string) => string
): string {
  return item.label ? tCollaboration(item.label.key) : t(`sections.${item.i18nKey}`)
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <SidebarProvider className="h-auto min-h-0 w-full shrink-0 md:h-full md:w-auto">
      <AppSidebarFrame {...props} />
    </SidebarProvider>
  )
}

function AppSidebarFrame({
  projectId,
  projects,
  user,
  organizationName = null,
  authRequired,
  canManageOrganization = false,
  canViewOrganization = false,
  canManagePlatform = false,
  canAccessOfficeShelf = false,
  canAccessOfficeStandards = false,
  showModels = false,
  showSkills = false,
  canAccessInbox,
  inboundMailEnabled = false,
  pathname: pathnameOverride,
}: AppSidebarProps) {
  const routerPathname = usePathname()
  const pathname = pathnameOverride ?? routerPathname ?? ''
  const t = useTranslations(navCopy)
  const tCollaboration = useTranslations(collaborationCopy)
  const { state, isMobile } = useSidebar()
  const { pending: inboxPending } = useInboxBadge(canAccessInbox)
  const inboxDoor = useStartDockDoor('inbox')
  const inboundMail = useInboundMailWaiting(projectId, inboundMailEnabled)
  const railChats = useRailChats()

  const base = `/app/projects/${projectId}`

  const isChatRoute = pathname === `${base}/chat` || pathname.startsWith(`${base}/chat/`)
  const iconRail = state === 'collapsed' && !isMobile
  const chatOpen = !iconRail && (railChats?.items.some((chat) => chat.current) ?? false)
  const back = phoneBackTarget(pathname, projectId)
  const pageHasHeader = framesProjectPage(pathname, projectId)

  useRecordProjectSection(projectId)
  useRecordRecentProject(projectId)

  React.useEffect(() => {
    pruneProjectSections(projects.map((project) => project.id))
  }, [projects])

  const groups: RailGroupModel[] = railGroups({ showSkills, showModels, canAccessOfficeShelf, canAccessOfficeStandards, canAccessInbox }).map(
    (group) => ({
      key: group.group,
      label: group.group === 'org' && organizationName ? organizationName : t(`sectionGroups.${group.group}`),
      items: group.items.map((item) => ({
        key: item.key,
        href: sectionLinkHref(item, base),
        icon: item.icon,
        label: sectionLabel(item, t, tCollaboration),
        active: pathname.startsWith(sectionHref(item, base)) && !(item.key === 'chat' && chatOpen),
        within: item.key === 'chat' && chatOpen,
        badgeCount: item.key === 'inbox' ? inboxPending : 0,
        door: item.key === 'inbox' ? inboxDoor : undefined,
        waitingCount: item.key === 'files' ? inboundMail.count : null,
        shortcutKey: item.shortcutKey,
      })),
    })
  )

  const orgGroup = groups.find((g) => g.key === 'org')
  const settingsHref = sectionHref(PROJECT_SETTINGS_SECTION, base)
  const overview: RailItemModel = {
    key: PROJECT_SETTINGS_SECTION.key,
    href: settingsHref,
    icon: PROJECT_SETTINGS_SECTION.icon,
    label: sectionLabel(PROJECT_SETTINGS_SECTION, t, tCollaboration),
    active: pathname.startsWith(settingsHref),
    badgeCount: 0,
    waitingCount: null,
    shortcutKey: PROJECT_SETTINGS_SECTION.shortcutKey,
  }
  const projectItems: RailItemModel[] = groups
    .filter((g) => g.key !== 'org')
    .flatMap((g) => g.items)
    .flatMap((item) => (item.key === 'files' ? [item, overview] : [item]))

  const activePillId = railActivePillId(iconRail)
  const railItem = (item: RailItemModel): React.JSX.Element => (
    <RailNavItem
      key={item.key}
      tourAnchor={sectionAnchor(item.key)}
      icon={item.icon}
      href={item.href}
      active={item.active}
      within={item.within}
      label={item.label}
      badgeCount={item.badgeCount}
      waitingCount={item.waitingCount}
      tooltip={iconRail}
      shortcutKey={item.shortcutKey}
      pillId={activePillId}
      door={item.door}
    />
  )
  const column = iconRail ? 'px-3.5' : 'px-3'

  return (
    <>
      {/* The top of a phone page. Hidden on chat, whose toolbar is its own.
          Where the page has a header (`ProjectSectionFrame`: every page but
          the bare flows) this draws nothing: the page starts with its title,
          whose line holds the way back and the search. What is left here is
          the screen's top inset and the connection's line, which takes room
          only while the link is not fine. No project name stands above a
          phone page, as a band or as a crumb: the project is the first row of
          „Mehr" in the tab bar (`PhoneTabBar`), and nowhere else on a phone. */}
      <header
        data-scope="project"
        className={cn(
          'bg-background w-full shrink-0 flex-col pt-[env(safe-area-inset-top)] md:hidden',
          isChatRoute ? 'hidden' : 'flex'
        )}
      >
        {/* A bare flow (the Einrichtung) has no page header: its way back and the search keep one 44px line. */}
        {!pageHasHeader && (
        <div data-slot="phone-bare-line" className="flex min-h-11 items-center gap-1 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          {back && (
            <Link
              href={back.href}
              aria-label={t('backTo', { label: t(`sections.${back.sectionKey}`) })}
              className="text-muted-foreground hover:text-foreground active:bg-desk flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-quick ease-out motion-reduce:transition-none"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
          )}
          <ShellSearchButton className="ml-auto" />
        </div>
        )}
        {isMobile && <ConnectionBand />}
      </header>

      <Sidebar collapsible="icon" data-scope="project" aria-label={t('projectNavigation')}>
        {/* `shrink-0` on the header and footer is load-bearing, not defensive.
            `SidebarContent` between them is `flex-1 basis-0`, whose scaled
            shrink factor is 0 — so under a height deficit the whole deficit
            lands here. Normally `min-height: auto` protects a flex item from
            that, but the `overflow-hidden` these two carry in the icon rail
            (to stop labels painting past 64px) sets the automatic minimum size
            to 0. Without `shrink-0` the footer is squeezed to nothing and, being
            clipped rather than scrollable, crops its last child — the user
            avatar — silently. */}
        <SidebarHeader
          className={cn(
            'shrink-0 gap-0 p-0 pt-[env(safe-area-inset-top)]',
            column,
            iconRail && 'overflow-hidden pb-px'
          )}
        >
          <SidebarBrand iconRail={iconRail} />
          {/* The project selector, the rail's first control in both widths:
              which project this is, and the way to another. The icon rail
              keeps it as a tile of its initials, or a collapsed rail could
              not say which project its sections belong to. */}
          <div className={cn('flex items-center', iconRail ? 'mt-2 justify-center' : 'mt-1')}>
            <ProjectSwitcher projects={projects} activeProjectId={projectId} collapsed={iconRail} />
          </div>
        </SidebarHeader>

        <SidebarContent
          className={cn(
            'mt-3 min-h-0 flex-1 gap-0 overflow-hidden',
            column
          )}
        >
          <nav aria-label={t('projectSections')} className="shrink-0 py-px">
            <SidebarMenu className="gap-0.5">{projectItems.map(railItem)}</SidebarMenu>
          </nav>
          {/* The project's last chats, as a list of their own under the sections (owner decision 2026-11-11,
              as a chat app lists its recent chats): headed „Letzte Chats“, scrolling between the sections
              and the office's doorways, which both stay put. The icon rail has no room for a title: there
              „Chat“ is its glyph, and the chat's toolbar names its door. */}
          {railChats && !iconRail && <RailChatList chats={railChats} pillId={activePillId} />}
        </SidebarContent>

        <SidebarFooter
          className={cn(
            'shrink-0 gap-0 p-0 pb-[max(12px,env(safe-area-inset-bottom))] pt-4',
            column,
            iconRail && 'items-center overflow-hidden'
          )}
        >
          {/* The office at the foot, the project at the top: two owners at
              the band's two ends, so neither reads as the other's and the
              band is held at both. Stacked under the project's sections the
              two heads fought and the lower 60% of the band stood empty. */}
          {orgGroup && (
            <nav aria-label={orgGroup.label} className={cn('mb-5', iconRail ? 'w-9' : 'w-full')}>
              <SidebarGroup className="p-0">
                {/* The organisation's name as the group's label (12/16/500
                    muted, the app's `SectionLabel` step), on the icons' edge. */}
                {!iconRail && (
                  <div className="text-muted-foreground text-meta flex min-h-6 items-end px-3 pb-1.5 font-medium" title={orgGroup.label}>
                    <span className="truncate">{orgGroup.label}</span>
                  </div>
                )}
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">{orgGroup.items.map(railItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </nav>
          )}
          {/* The connection says something only when it is not fine: a row
              above the person while it reconnects or is gone, nothing (to the
              eye) while all is well. Nothing above it moves when it appears:
              the space it takes is the band's empty middle. */}
          <ConnectionBand appearance="rail" compact={iconRail} />
          <SidebarUserMenu
            user={user}
            organizationName={organizationName}
            authRequired={authRequired}
            compact={iconRail}
            avatarSizeClass="size-6"
            menuSide={iconRail ? 'right' : 'top'}
            menuAlign="end"
            menuSideOffset={iconRail ? 24 : 6}
            menuMatchTrigger={!iconRail}
            canManageOrganization={canManageOrganization}
            canViewOrganization={canViewOrganization}
            canManagePlatform={canManagePlatform}
          />
        </SidebarFooter>
        {/* The primitive's own strings are English; the rail is a tab stop now,
            so the one control a keyboard user lands on has to speak the app's
            language like every other. `iconRail` is already the collapse
            control's source of truth two rows up — same state, same wording. */}
        <SidebarRail
          aria-label={t('resizeSidebar')}
          title={iconRail ? t('expandSidebarHint') : t('resizeSidebarHint')}
        />
      </Sidebar>
    </>
  )
}

function RailNavItem({
  icon: Icon,
  href,
  active,
  within = false,
  label,
  badgeCount,
  waitingCount = null,
  tooltip,
  shortcutKey,
  pillId,
  tourAnchor,
  door,
}: {
  icon: ProjectSection['icon']
  href: string
  active: boolean
  within?: boolean
  label: string
  badgeCount: number
  waitingCount?: number | null
  tooltip: boolean
  shortcutKey?: string
  pillId: string
  tourAnchor: string
  door?: StartDockDoor
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={tooltip || shortcutKey ? { children: <RailTooltip label={tooltip ? label : null} shortcutKey={shortcutKey} /> } : undefined}
        tooltipWhenExpanded={!tooltip && Boolean(shortcutKey)}
        className={cn(
          'text-muted-foreground h-9 gap-[11px] rounded-control px-3 text-[13px] font-normal hover:text-foreground pointer-coarse:h-11',
          'group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:justify-center',
          active
            ? 'text-foreground data-[active=true]:text-foreground hover:bg-transparent active:bg-transparent data-[active=true]:bg-transparent font-medium data-[active=true]:font-medium'
            : door?.open
              ? // The Postfach docked open beside the page: open is the picked
                'text-foreground bg-selected hover:bg-selected'
              : // The pointer's fill is one step down from the plane it lies
                cn('hover:bg-selected active:bg-pressed', within && 'text-foreground font-medium')
        )}
      >
        <Link href={href} aria-current={active ? 'page' : undefined} aria-expanded={door?.open} data-dock-door={door?.panel} data-tour={tourAnchor} onClick={door?.onClick}>
          {active && (
            <motion.span
              layoutId={pillId}
              data-slot="rail-active-pill"
              aria-hidden
              className="bg-sheet absolute inset-0 rounded-control shadow-xs"
              transition={springGlide}
            />
          )}
          <Icon
            aria-hidden
            className={cn('relative size-4 shrink-0', !active && !within && 'text-muted-foreground')}
          />
          {/* `data-slot`, because the label is no longer the only <span> inside
              this anchor — the active pill is one too. A test (or a stylesheet)
              reaching for "the rail entry's text" should say so rather than
              picking the first span and hoping. */}
          <span
            data-slot="rail-nav-label"
            className={cn('truncate', tooltip ? 'sr-only' : 'relative')}
          >
            {label}
          </span>
          <InboxBadge
            pending={badgeCount}
            tone="muted"
            className="relative ml-auto group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:ring-2 group-data-[collapsible=icon]:ring-sidebar"
          />
          {badgeCount <= 0 && (
            <InboundMailWaitingBadge
              count={waitingCount}
              className="relative ml-auto group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:ring-2 group-data-[collapsible=icon]:ring-sidebar"
            />
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function RailTooltip({ label, shortcutKey }: { label: string | null; shortcutKey?: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {shortcutKey && (
        <ShortcutKeys
          segments={[
            { kind: 'chord', caps: [LEADER_KEY.toUpperCase()] },
            { kind: 'then' },
            { kind: 'chord', caps: [shortcutKey.toUpperCase()] },
          ]}
        />
      )}
    </span>
  )
}
