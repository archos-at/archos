'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Folder, SquarePen } from 'lucide-react'

import { AnimatePresence, motion, motionInstant, motionQuick, motionSnap } from '@/components/motion'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
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
import { InboxBell } from '@/features/collaboration/components'
import { cn } from '@/lib/utils'
import { SidebarBrand } from './sidebar-brand'
import { ProjectSwitcher, type ProjectSwitcherProject } from './project-switcher'
import { SidebarUserMenu } from './sidebar-user-menu'
import { shellAccount, type ShellAccount } from './shell-account'
import { onSideChat } from './shell-side'
import {
  railGroups,
  isSectionPathActive,
  PROJECT_SETTINGS_SECTION,
  sectionLinkHref,
  type ProjectNavGroup,
  type ProjectSection,
} from './project-sections'
import { phoneBackTarget } from './phone-back'
import { useRecordRecentProject } from './recent-projects'
import { framesProjectPage } from './project-section-frame'
import { PhoneFloatingBar } from './phone-floating-bar'
import { useShellOverlays } from './shell-overlays'
import { RailActivePill } from './rail-active-pill'
import { RailChatList, useRailChats } from './rail-chats'
import { RailModeSwitch } from './rail-mode-switch'
import { shownSide, useRailSide } from './rail-side'
import { NEW_PERSONAL_CHAT_HREF, PERSONAL_CHAT_PATH, PERSONAL_SHELF_PATH, type RailMode } from './rail-mode'
import { ConnectionBand } from './connection-band'
import { ShortcutKeys } from './shortcut-keys'
import { LEADER_KEY } from './shortcuts'
import { TOUR_ANCHORS, sectionAnchor } from '@/lib/onboarding/product-tour'


const SIDE_DIRECTION: Record<RailMode, number> = { personal: -1, project: 1 }
const SIDE_SLIDE_PX = 10

const SIDE_VARIANTS = {
  enter: (direction: number) => ({ opacity: 0, x: direction * SIDE_SLIDE_PX }),
  shown: { opacity: 1, x: 0 },
  leave: (direction: number) => ({ opacity: 0, x: -direction * SIDE_SLIDE_PX, transition: direction === 0 ? motionInstant : motionSnap }),
}
export function railActivePillId(iconRail: boolean, side: RailMode): string {
  return `rail-active-${side}-${iconRail ? 'icon' : 'full'}`
}

export interface AppSidebarProps extends ShellAccount {
  projectId: string | null
  onSide?: boolean
  projects: ProjectSwitcherProject[]
  canAccessOfficeShelf?: boolean
  canAccessOfficeStandards?: boolean
  showModels?: boolean
  showSkills?: boolean
  canAccessInbox: boolean
  inboundMailEnabled?: boolean
  pathname?: string
  navigateSide?: (href: string) => void
  phoneMenuMark?: React.ReactNode
}

export interface RailItemModel {
  key: string
  href: string
  icon: ProjectSection['icon']
  label: string
  active: boolean
  within?: boolean
  waitingCount: number | null
  waitingMore?: boolean
  shortcutKey?: string
}

export interface RailGroupModel {
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

function AppSidebarFrame(props: AppSidebarProps) {
  const {
    projectId,
    onSide = true,
    projects,
    organizationName = null,
    canAccessOfficeShelf = false,
    canAccessOfficeStandards = false,
    showModels = false,
    showSkills = false,
    canAccessInbox,
    inboundMailEnabled = false,
    pathname: pathnameOverride,
    navigateSide,
    phoneMenuMark,
  } = props
  const routerPathname = usePathname()
  const pathname = pathnameOverride ?? routerPathname ?? ''
  const t = useTranslations(navCopy)
  const tCollaboration = useTranslations(collaborationCopy)
  const { state, isMobile, peek } = useSidebar()
  const railChats = useRailChats()
  const pending = useRailSide((state) => state.pending)
  const side = shownSide(pending, { mode: projectId === null ? 'personal' : 'project', projectId })!
  const mode: RailMode = side.mode
  const sideProjectId = side.projectId
  const inboundMail = useInboundMailWaiting(sideProjectId, inboundMailEnabled)
  const reduceMotion = useReducedMotion()

  const base = sideProjectId === null ? '' : `/app/projects/${sideProjectId}`

  const onChat = onSideChat(pathname, projectId, onSide)
  const iconRail = state === 'collapsed' && !isMobile && !peek
  const chatOpen = railChats ? (railChats.chatOpen ?? railChats.items.some((chat) => chat.current)) : false
  const back = projectId === null || !onSide ? null : phoneBackTarget(pathname, projectId)
  const menuOpen = useShellOverlays((s) => s.menuOpen)
  const setMenuOpen = useShellOverlays((s) => s.setMenuOpen)
  const paletteOpen = useShellOverlays((s) => s.paletteOpen)
  React.useEffect(() => {
    setMenuOpen(false)
  }, [pathname, paletteOpen, setMenuOpen])

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
        icon: item.key === 'chat' ? SquarePen : item.icon,
        label: item.key === 'chat' ? t('newChat') : sectionLabel(item, t, tCollaboration),
        active: isSectionPathActive(item, base, pathname) && !(item.key === 'chat' && chatOpen),
        within: item.key === 'chat' && chatOpen && !iconRail,
        waitingCount: item.key === 'files' ? inboundMail.count : null,
        waitingMore: item.key === 'files' && inboundMail.more,
        shortcutKey: item.shortcutKey,
      })),
    })
  )

  const org = groups.find((g) => g.key === 'org')
  const orgGroup = org && { ...org, items: org.items.filter((item) => iconRail || item.key !== 'search') }
  const projectItems: RailItemModel[] =
    mode === 'personal'
      ? personalRailItems(pathname, t, chatOpen, iconRail)
      : [
          ...groups.filter((g) => g.key !== 'org').flatMap((g) => g.items),
          ...(isMobile && sideProjectId !== null ? [projectOverviewItem(base, pathname, t)] : []),
        ]

  const activePillId = railActivePillId(iconRail, mode)
  const railItem = (item: RailItemModel): React.JSX.Element => (
    <RailNavItem
      key={item.key}
      tourAnchor={sectionAnchor(item.key)}
      icon={item.icon}
      href={item.href}
      active={item.active}
      within={item.within}
      label={item.label}
      waitingCount={item.waitingCount}
      waitingMore={item.waitingMore}
      tooltip={iconRail}
      shortcutKey={item.shortcutKey}
      pillId={activePillId}
    />
  )
  const column = iconRail ? 'px-3.5' : 'px-3'

  return (
    <>
      <PhoneFloatingBar
        onChat={onChat}
        newChatHref={sideProjectId === null ? NEW_PERSONAL_CHAT_HREF : `/app/projects/${sideProjectId}/chat?new=1`}
        back={back && !framesProjectPage(pathname, projectId!) ? { href: back.href, label: t('backTo', { label: t(`sections.${back.sectionKey}`) }) } : null}
        menuMark={phoneMenuMark}
      />

      <Sidebar
        collapsible="icon"
        peekOnHover
        drawer={{ open: menuOpen, onOpenChange: setMenuOpen, label: t('phoneMenu.title') }}
        data-scope={mode}
        aria-label={t(mode === 'personal' ? 'personalNavigation' : 'projectNavigation')}
      >
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
            iconRail && 'overflow-hidden'
          )}
        >
          <SidebarBrand iconRail={iconRail} />
          <div className={cn('flex', iconRail ? 'mt-2 justify-center' : 'mb-1.5')}>
            <RailModeSwitch mode={mode} collapsed={iconRail} navigate={navigateSide} tourAnchor={TOUR_ANCHORS.sides} />
          </div>
          {projectId !== null && onSide && <ProjectRecorder projectId={projectId} />}
        </SidebarHeader>

        <SidebarContent className={cn('relative min-h-0 flex-1 gap-0 overflow-hidden', column)}>
          <AnimatePresence initial={false} mode="popLayout" custom={reduceMotion ? 0 : SIDE_DIRECTION[mode]}>
            <motion.div
              key={mode}
              data-slot="rail-side"
              data-side={mode}
              custom={reduceMotion ? 0 : SIDE_DIRECTION[mode]}
              variants={SIDE_VARIANTS}
              initial="enter"
              animate="shown"
              exit="leave"
              transition={reduceMotion ? motionInstant : motionQuick}
              className="flex min-h-0 flex-1 flex-col"
            >
          {/* The project selector, the rail's first control in both widths:
              which project this is, and the way to another. The icon rail
              keeps it as a tile of its initials, on the selector's own line,
              so nothing below it moves when the rail opens under the pointer. */}
          {sideProjectId !== null && (
            <div data-tour={TOUR_ANCHORS.projectSwitcher} className={cn('mt-1 flex h-10 shrink-0 items-center pointer-coarse:h-11', iconRail && 'justify-center')}>
              <ProjectSwitcher projects={projects} activeProjectId={sideProjectId} collapsed={iconRail} />
            </div>
          )}
          <nav
            aria-label={t(mode === 'personal' ? 'personalNavigation' : 'projectSections')}
            className={cn('shrink-0 py-px', mode === 'personal' && !iconRail ? 'mt-4' : 'mt-3')}
          >
            <SidebarMenu className="gap-0.5">{projectItems.map(railItem)}</SidebarMenu>
          </nav>
          {/* The project's last chats, as a list of their own under the sections (owner decision 2026-11-11,
              as a chat app lists its recent chats): headed „Letzte Chats“, scrolling between the sections
              and the office's doorways, which both stay put. The icon rail has no room for a title: there
              „Chat“ is its glyph, and the chat's toolbar names its door. */}
          {railChats && !iconRail && <RailChatList chats={railChats} />}
            </motion.div>
          </AnimatePresence>
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
          <div className={cn('relative flex min-w-0 items-center gap-1', iconRail ? 'flex-col-reverse' : 'w-full')} data-slot="rail-person">
            <div className={cn('min-w-0', !iconRail && 'flex-1')}>
              <SidebarUserMenu
                {...shellAccount(props)}
                tourAnchor={TOUR_ANCHORS.account}
                compact={iconRail}
                avatarSizeClass="size-6"
                menuSide={iconRail ? 'right' : 'top'}
                menuAlign="end"
                menuSideOffset={iconRail ? 24 : 6}
                menuMatchTrigger={!iconRail}
                beforeChevron={canAccessInbox && !iconRail ? 'w-12' : undefined}
              />
            </div>
            {canAccessInbox && (
              <InboxBell
                compact={iconRail}
                tourAnchor={TOUR_ANCHORS.inbox}
                pathname={pathname}
                className={iconRail ? undefined : 'absolute right-8 top-1/2 z-10 h-7 min-w-7 -translate-y-1/2 border-transparent px-1.5 pointer-coarse:h-9'}
              />
            )}
          </div>
        </SidebarFooter>
        {/* The primitive's own strings are English; the rail is a tab stop now,
            so the one control a keyboard user lands on has to speak the app's
            language like every other. `iconRail` is already the collapse
            control's source of truth two rows up — same state, same wording. */}
        {!isMobile && (
          <SidebarRail
            aria-label={t('resizeSidebar')}
            title={iconRail ? t('expandSidebarHint') : t('resizeSidebarHint')}
          />
        )}
      </Sidebar>
    </>
  )
}


function ProjectRecorder({ projectId }: { projectId: string }): null {
  useRecordProjectSection(projectId)
  useRecordRecentProject(projectId)
  return null
}

const UNDER_OVERVIEW: readonly string[] = ['settings', 'setup', 'intake']

/** The desktop reaches the project's overview through the project selector; the drawer lists it, as the phone's tab did. */
function projectOverviewItem(base: string, pathname: string, t: (key: string) => string): RailItemModel {
  return {
    key: 'settings',
    href: `${base}/settings`,
    icon: PROJECT_SETTINGS_SECTION.icon,
    label: t('sections.settings'),
    active: UNDER_OVERVIEW.some((segment) => pathname === `${base}/${segment}` || pathname.startsWith(`${base}/${segment}/`)),
    waitingCount: null,
  }
}

function personalRailItems(pathname: string, t: (key: string) => string, chatOpen: boolean, iconRail: boolean): RailItemModel[] {
  const onChat = pathname === PERSONAL_CHAT_PATH || pathname.startsWith(`${PERSONAL_CHAT_PATH}/`)
  const onShelf = pathname === PERSONAL_SHELF_PATH || pathname.startsWith(`${PERSONAL_SHELF_PATH}/`)
  const row = (key: string, href: string, icon: ProjectSection['icon'], label: string, active: boolean): RailItemModel => ({
    key,
    href,
    icon,
    label,
    active,
    waitingCount: null,
  })
  return [
    { ...row('chat', NEW_PERSONAL_CHAT_HREF, SquarePen, t('newChat'), onChat && !chatOpen), within: onChat && chatOpen && !iconRail },
    row('personalShelf', PERSONAL_SHELF_PATH, Folder, t('personalShelf'), onShelf),
  ]
}

export function RailNavItem({
  icon: Icon,
  href,
  active,
  within = false,
  label,
  waitingCount = null,
  waitingMore = false,
  tooltip,
  shortcutKey,
  pillId,
  tourAnchor,
}: {
  icon: ProjectSection['icon']
  href: string
  active: boolean
  within?: boolean
  label: string
  waitingCount?: number | null
  waitingMore?: boolean
  tooltip: boolean
  shortcutKey?: string
  pillId: string
  tourAnchor: string
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
            : // The pointer's fill is one step down from the plane it lies
              cn('hover:bg-selected active:bg-pressed', within && 'text-foreground font-medium')
        )}
      >
        <Link href={href} aria-current={active ? 'page' : undefined} data-tour={tourAnchor}>
          {active && (
            <RailActivePill pillId={pillId} at={href} />
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
          <InboundMailWaitingBadge
            count={waitingCount}
            more={waitingMore}
            className="relative ml-auto group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:ring-2 group-data-[collapsible=icon]:ring-sidebar"
          />
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
