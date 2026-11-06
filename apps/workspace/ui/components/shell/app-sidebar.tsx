'use client'

/**
 * The GRID application sidebar — the product's primary navigation surface, and
 * since the app-shell change the ONE persistent piece of chrome in `/app`.
 *
 * Composes the shadcn Sidebar primitive (Sheet on mobile, icon-collapse on
 * desktop) rather than owning a drawer, a rail, and collapse itself. IA: the
 * wordmark → the project switcher, which heads the project's sections
 * (Übersicht among them) → the organisation's doorways at the foot → the
 * person. The rail is the one grey; what sits on it is white, the active
 * section included, and nothing on it is a box or a rule (design-language.md,
 * „The app rail“).
 *
 * PROJECT SCOPE ONLY. The rail earns its 236px by listing one project's
 * sections; above a project the org scope renders a slim header instead
 * (`OrgHeader`), and `AppShellChrome` decides which of the two stands. The
 * org-wide doorways (Archiv, Postfach) still appear here — as the `org` group
 * near the bottom — because they are reachable from inside a project, where
 * they open as sheets above it.
 *
 * Mobile open state is owned by the layout store so the chat toolbar's
 * hamburger can open the same Sheet (`useLayoutStore.setMobileNavOpen`).
 * Collapse persistence lives in the primitive (`sidebar.collapsed`).
 */

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
  SidebarGroupLabel,
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
import { useLayoutStore } from '@/features/layout/store'
import { InboundMailWaitingBadge } from './inbound-mail-waiting-badge'
import { useInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { useInboxBadge } from '@/features/collaboration/hooks/use-inbox'
import { useStartDockDoor, type StartDockDoor } from './start-dock'
import { InboxBadge } from '@/features/collaboration/components'
import { cn } from '@/lib/utils'
import { ProjectPill } from './project-pill'
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
import { useRecordRecentProject } from './recent-projects'
import { useShellOverlays } from './shell-overlays'
import { ShellSearchButton } from './shell-search-button'
import { ConnectionBand } from './connection-band'
import { sectionAnchor } from '@/lib/onboarding/product-tour'

/**
 * THE ACTIVE PILL'S SHARED-LAYOUT IDENTITY.
 *
 * Every rail entry that is currently active renders the same `motion.span`
 * under this id, so when the route changes React unmounts one and mounts the
 * other in a single commit and motion glides the chip between them instead of
 * repainting it. That trajectory is the design language's rule 2 — DIRECTION
 * OF TRAVEL: the pill's path says which section you just left and roughly how
 * far back up the rail it is, which is exactly the thing a reader needs to
 * find their way back and the one thing the endpoint alone cannot say.
 *
 * The id is KEYED by rail width, which is load-bearing: collapsing to the icon
 * rail is a size change, not a move. Sharing an id across it would ask motion
 * to animate a 212×36 pill into a 36×36 one, and a shared-layout size change is
 * executed as a `scale`, which visibly smears the pill's radius.
 * Keyed, the pill is re-created at the new size in the same pass the rail
 * resizes in.
 *
 * Within one key every entry is the same width and height, so the animation
 * reduces to a pure vertical translate — no scale, hence no radius distortion
 * to correct.
 */
export function railActivePillId(iconRail: boolean): string {
  return `rail-active-project-${iconRail ? 'icon' : 'full'}`
}

export interface AppSidebarProps {
  /** The project whose sections the rail lists. The rail is project scope
   *  only — `AppShellChrome` renders `OrgHeader` above a project instead. */
  projectId: string
  projects: ProjectSwitcherProject[]
  user?: SidebarUser
  /**
   * The organization the reader is acting in. Shown as an eyebrow above their
   * name in the rail footer — every project, the Archiv and the Inbox are
   * scoped to one org, and the rail never said which.
   */
  organizationName?: string | null
  authRequired: boolean
  /** Whether the current user can manage the organization (org admin). */
  canManageOrganization?: boolean
  /**
   * Whether the current user may open the organization page at all. True for
   * every authenticated org member — the org page serves capability subsets
   * (budgets/models/audit) and a member self-usage view, so the nav entry is
   * discoverable even for non-admins (UX-16).
   */
  canViewOrganization?: boolean
  /** Whether the current user is the platform owner (ADR-0016). */
  canManagePlatform?: boolean
  /**
   * Whether the org-wide Archiv is reachable (any member of an organization,
   * ADR-0024). Also gates the Archiv nav item.
   */
  canAccessOfficeShelf?: boolean
  /** Whether the IFC/BIM model page is enabled (`ifc-models`, ADR-0045). */
  showModels?: boolean
  /** Whether the Agent Skills page is enabled (feature-flagged, default off — ADR-0046). */
  showSkills?: boolean
  /**
   * Whether the inbox is reachable for this reader. Gates the Inbox nav entry —
   * and with it the badge subscription, so a gated reader opens no live
   * connection and issues no request (spec NF-8).
   *
   * Not the collaboration flag since ADR-0042: the inbox also carries
   * operational alerts, and hiding the entry from a tenant without
   * collaboration hid the warning that its storage was filling up.
   *
   * REQUIRED, unlike its neighbours. It used to default to `false`, and two of
   * the three callers — the dev preview and the spec fixture — omitted it, so
   * both silently exercised the HIDDEN state: the entry was missing and the badge
   * subscription never opened, in exactly the two places whose job is to show
   * what the rail looks like. A required prop turns that into a compile error.
   */
  canAccessInbox: boolean
  /**
   * The office receives project mail (`inbound-mail`, ADR-0137): Dateien
   * carries the muted count of mail waiting for this reader. Optional and off
   * by default, so a preview without it shows the rail as it was.
   */
  inboundMailEnabled?: boolean
  /** The route the rail lights; the router's by default. A preview passes one, as it does to `PhoneTabBar`. */
  pathname?: string
}

/** One rendered rail entry, after both scopes have been reduced to a shape. */
interface RailItemModel {
  key: string
  href: string
  icon: ProjectSection['icon']
  label: string
  active: boolean
  badgeCount: number
  /** The Postfach's: it may open beside the page instead of following `href`. */
  door?: StartDockDoor
  /** A quiet count beside the entry (mail waiting in Dateien); the Postfach's ink pill is `badgeCount`. */
  waitingCount: number | null
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

  const projectSheetOpen = useShellOverlays((s) => s.projectSheetOpen)
  const setProjectSheetOpen = useShellOverlays((s) => s.setProjectSheetOpen)

  const base = `/app/projects/${projectId}`

  // Chat owns its top chrome (floating pills), so the global mobile top bar is
  // redundant there — hide it and let the chat toolbar host the nav opener.
  const isChatRoute = pathname === `${base}/chat` || pathname.startsWith(`${base}/chat/`)
  const iconRail = state === 'collapsed' && !isMobile
  const activeProject = projects.find((project) => project.id === projectId)
  const back = phoneBackTarget(pathname, projectId)

  useRecordProjectSection(projectId)
  useRecordRecentProject(projectId)

  React.useEffect(() => {
    pruneProjectSections(projects.map((project) => project.id))
  }, [projects])

  const groups: RailGroupModel[] = railGroups({ showSkills, showModels, canAccessOfficeShelf, canAccessInbox }).map(
    (group) => ({
      key: group.group,
      label: t(`sectionGroups.${group.group}`),
      items: group.items.map((item) => ({
        key: item.key,
        href: sectionLinkHref(item, base),
        icon: item.icon,
        label: sectionLabel(item, t, tCollaboration),
        active: pathname.startsWith(sectionHref(item, base)),
        badgeCount: item.key === 'inbox' ? inboxPending : 0,
        door: item.key === 'inbox' ? inboxDoor : undefined,
        waitingCount: item.key === 'files' ? inboundMail.count : null,
      })),
    })
  )

  // The project's own sections under its switcher, Übersicht (the project hub)
  // last among them: it is the project's, and at the foot under „Organisation“
  // proximity read it as the organisation's. The switcher is the group's
  // heading, so the group carries no label of its own. The organisation's
  // doorways (Archiv, Suche, Postfach) stand at the foot, labelled.
  const orgGroup = groups.find((g) => g.key === 'org')
  const settingsHref = sectionHref(PROJECT_SETTINGS_SECTION, base)
  const projectItems: RailItemModel[] = [
    ...groups.filter((g) => g.key !== 'org').flatMap((g) => g.items),
    {
      key: PROJECT_SETTINGS_SECTION.key,
      href: settingsHref,
      icon: PROJECT_SETTINGS_SECTION.icon,
      label: sectionLabel(PROJECT_SETTINGS_SECTION, t, tCollaboration),
      active: pathname.startsWith(settingsHref),
      badgeCount: 0,
      waitingCount: null,
    },
  ]

  const activePillId = railActivePillId(iconRail)
  const railItem = (item: RailItemModel): React.JSX.Element => (
    <RailNavItem
      key={item.key}
      tourAnchor={sectionAnchor(item.key)}
      icon={item.icon}
      href={item.href}
      active={item.active}
      label={item.label}
      badgeCount={item.badgeCount}
      waitingCount={item.waitingCount}
      tooltip={iconRail}
      pillId={activePillId}
      door={item.door}
    />
  )
  // 14px in the icon rail, so a 36px tile centres at x=32 in the 64px rail:
  // the axis of the brand mark, the project tile, the icons and the avatar.
  // 12px expanded, so the icons, the wordmark and the labels start at 24.
  const column = iconRail ? 'px-3.5' : 'px-3'

  return (
    <>
      <MobileNavSync pathname={pathname} />

      {/* The phone's top band. Hidden on chat, whose toolbar is its own top
          band. The project's name is the door to the switcher sheet; the
          destinations live in the tab bar at the bottom (`PhoneTabBar`), and
          "Mehr" there opens this rail as a drawer. */}
      <header
        data-scope="project"
        data-surface="sunken"
        className={cn(
          // The app renders edge-to-edge (`viewportFit: 'cover'` in the root
          // viewport), so a bar pinned to the top of the screen has to say where
          // the screen actually starts. `min-h-14` rather than `h-14`, because the
          // inset has to be able to make the bar taller instead of eating its
          // contents. No rule under it: the band is the one grey, the page white.
          'bg-surface-sunken w-full shrink-0 flex-col pt-[env(safe-area-inset-top)] md:hidden',
          isChatRoute ? 'hidden' : 'flex'
        )}
      >
        <div className="flex min-h-14 items-center gap-1 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          {back && (
            <Link
              href={back.href}
              aria-label={t('backTo', { label: t(`sections.${back.sectionKey}`) })}
              className="text-muted-foreground hover:bg-on-sunken-hover hover:text-foreground focus-visible:ring-ring/60 flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
          )}
          <ProjectPill
            name={activeProject?.name ?? t('projectSwitcher.select')}
            label={
              activeProject
                ? t('projectSwitcher.switchCurrent', { name: activeProject.name })
                : t('projectSwitcher.select')
            }
            expanded={projectSheetOpen}
            onOpen={() => setProjectSheetOpen(true)}
            className={back ? undefined : 'ml-1'}
          />
          <ShellSearchButton className="ml-auto" />
        </div>
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
            // On a phone this is the top of a full-height drawer, under the
            // status bar; the inset is 0 everywhere else. The brand row below
            // carries the rest (`brand-slot.ts`): 56px, as the org header's band.
            'shrink-0 gap-0 p-0 pt-[env(safe-area-inset-top)]',
            column,
            iconRail && 'overflow-hidden'
          )}
        >
          <SidebarBrand iconRail={iconRail} />
          {/* The context slot, in both widths: which project this is, and the
              way to another. The icon rail keeps it as a tile, or a collapsed
              rail could not say which project its sections belong to. `h-9` is
              the switcher's own height, pinned so the nav below always starts
              at the same edge; `mt-2` under the 56px brand row puts its top at
              64px. */}
          <div className={cn('mt-2 flex h-9 items-center pointer-coarse:h-11', iconRail && 'justify-center')}>
            <ProjectSwitcher projects={projects} activeProjectId={projectId} collapsed={iconRail} />
          </div>
        </SidebarHeader>

        <SidebarContent
          className={cn(
            // 16px under the switcher: near enough to read as what it heads,
            // far enough not to read as the first row.
            'mt-4 flex-1',
            column,
            // overflow-y-auto here used to replace the primitive's
            // group-data-[collapsible=icon]:overflow-hidden, so labels kept
            // painting past the 64px rail.
            iconRail ? 'overflow-hidden' : 'overflow-y-auto'
          )}
        >
          <nav aria-label={t('projectSections')}>
            <SidebarMenu className="gap-0.5">{projectItems.map(railItem)}</SidebarMenu>
          </nav>
        </SidebarContent>

        {/* The organisation's doorways, pinned to the foot so the project's
            list stays its own and the scope change has a place. Separated by
            the space above them and their label, not by a rule. */}
        {orgGroup && (
          <nav aria-label={orgGroup.label} className={cn('shrink-0 pt-4', column)}>
            <SidebarGroup className="p-0">
              {/* `px-3`: the label starts on the icons' edge (24px), as the
                  wordmark does; the primitive's 8px put it 4px left of both. */}
              {!iconRail && <SidebarGroupLabel className="px-3">{orgGroup.label}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">{orgGroup.items.map(railItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
        )}

        <SidebarFooter
          className={cn(
            // The drawer runs to the bottom of the screen, where the home
            // indicator sits over the user menu without the inset.
            'shrink-0 gap-0 p-0 pb-[max(14px,env(safe-area-inset-bottom))] pt-4',
            column,
            iconRail && 'items-center overflow-hidden'
          )}
        >
          {/* The connection says something only when it is not fine: a row
              above the person while it reconnects or is gone, nothing (to the
              eye) while all is well. A phone shows it in its top band instead,
              which is in view while this drawer is closed. */}
          {!isMobile && <ConnectionBand appearance="rail" compact={iconRail} />}
          <SidebarUserMenu
            user={user}
            organizationName={organizationName}
            authRequired={authRequired}
            compact={iconRail}
            avatarSizeClass="size-8"
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

/**
 * Two-way bind the layout store (chat toolbar hamburger) to the primitive's
 * mobile Sheet. Store changes open/close the Sheet; Sheet dismissals (scrim,
 * Escape, the primitive's close) write back so the store never lies.
 */
function MobileNavSync({ pathname }: { pathname: string }) {
  const storeOpen = useLayoutStore((s) => s.isMobileNavOpen)
  const setStoreOpen = useLayoutStore((s) => s.setMobileNavOpen)
  const { openMobile, setOpenMobile } = useSidebar()
  const prev = React.useRef<{ storeOpen: boolean; openMobile: boolean } | null>(null)

  React.useEffect(() => {
    setStoreOpen(false)
  }, [pathname, setStoreOpen])

  React.useEffect(() => {
    const previous = prev.current
    if (previous === null) {
      prev.current = { storeOpen, openMobile }
      if (storeOpen !== openMobile) setOpenMobile(storeOpen)
      return
    }
    const storeChanged = storeOpen !== previous.storeOpen
    const mobileChanged = openMobile !== previous.openMobile
    prev.current = { storeOpen, openMobile }

    if (storeChanged && storeOpen !== openMobile) {
      setOpenMobile(storeOpen)
    } else if (mobileChanged && openMobile !== storeOpen) {
      setStoreOpen(openMobile)
    }
  }, [storeOpen, openMobile, setOpenMobile, setStoreOpen])

  return null
}

function RailNavItem({
  icon: Icon,
  href,
  active,
  label,
  badgeCount,
  waitingCount = null,
  tooltip,
  pillId,
  tourAnchor,
  door,
}: {
  icon: ProjectSection['icon']
  href: string
  active: boolean
  label: string
  badgeCount: number
  /** The muted count (mail waiting in Dateien); shown only where no ink pill is. */
  waitingCount?: number | null
  tooltip: boolean
  /** Shared-layout identity for the active chip — see {@link railActivePillId}. */
  pillId: string
  /** Marks the item as a product-tour stop (`data-tour`). */
  tourAnchor: string
  door?: StartDockDoor
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={tooltip ? label : undefined}
        className={cn(
          // 36px under a mouse; 44px under a finger, grown rather than given a
          // catchment, because the rows sit 2px apart.
          'h-9 gap-[11px] rounded-control px-3 text-[13px] pointer-coarse:h-11',
          'group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:justify-center',
          // The active SURFACE lives on the pill below, so every fill the
          // primitive would otherwise paint under it is turned off explicitly.
          // Only the INK stays here: colour and weight are a tween's business,
          // never a spring's.
          active
            ? 'text-foreground hover:bg-transparent hover:text-foreground data-[active=true]:bg-transparent data-[active=true]:text-foreground font-medium data-[active=true]:font-medium'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
        )}
      >
        <Link href={href} aria-current={active ? 'page' : undefined} aria-expanded={door?.open} data-dock-door={door?.panel} data-tour={tourAnchor} onClick={door?.onClick}>
          {active && (
            <motion.span
              layoutId={pillId}
              data-slot="rail-active-pill"
              aria-hidden
              // The selected entry is a fill, white on the grey rail
              // (`bg-on-sunken`): no border and no shadow, which made it the
              // one box on the rail (design-language.md, „The app rail“).
              //
              // `absolute inset-0` resolves against the LI, not the anchor: the
              // anchor is `overflow-hidden` (it clips long labels), and an
              // absolutely positioned box whose containing block is an ancestor
              // of the clipper is not clipped by it — the same mechanism that
              // already lets the icon-rail badge sit outside the tile. The li
              // and the anchor are the same box in both rail widths, so this
              // costs no geometry.
              className="bg-on-sunken absolute inset-0 rounded-control"
              // `springGlide`, not `springDrawer`. This chip's travel is
              // whatever the reader's last two routes happen to be — 38px
              // between neighbours, 288px from the top of the column to Inbox
              // at the bottom — and an overshooting spring's PIXEL error scales
              // with that distance. `springDrawer` lands at 0.53px on the short
              // hop and 4.0px on the long one, and 4px on a 38px row pitch is
              // the pill barging into the row above its target. Glide is
              // calibrated to stay under a pixel at any distance.
              transition={springGlide}
            />
          )}
          <Icon
            aria-hidden
            // `relative` on the visible content, rather than a z-index on the
            // pill. Both are then positioned siblings in document order, so the
            // later one paints over the earlier one — no stacking context to
            // create, and no negative z-index, which would fall straight
            // through to behind the rail's own background (`sidebar-container`
            // is the nearest stacking context, and a non-positioned block's
            // background paints ABOVE negative-z children inside it).
            className="relative size-4 shrink-0"
          />
          {/* `data-slot`, because the label is no longer the only <span> inside
              this anchor — the active pill is one too. A test (or a stylesheet)
              reaching for "the rail entry's text" should say so rather than
              picking the first span and hoping. */}
          <span
            data-slot="rail-nav-label"
            // `relative` ONLY when the label is visible. `sr-only` sets
            // `position: absolute` to take the text out of flow, and a later
            // `relative` in the cascade beats it — which put a 1px box plus the
            // row's 11px gap back into the icon rail and slid every glyph 5px
            // off the 32px centre line the rail is aligned to. A hidden label
            // has no paint order to fix, so it does not need the class.
            className={cn('truncate', tooltip ? 'sr-only' : 'relative')}
          >
            {label}
          </span>
          <InboxBadge
            pending={badgeCount}
            className="relative ml-auto group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:ml-0"
          />
          {badgeCount <= 0 && (
            <InboundMailWaitingBadge
              count={waitingCount}
              className="relative ml-auto group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:ml-0"
            />
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
