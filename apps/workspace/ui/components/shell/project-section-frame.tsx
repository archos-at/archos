'use client'

/**
 * Shared chrome for every project section except Chat.
 *
 * Chat owns its own header. Every other project page used to invent one
 * (PageHeader vs a hand-rolled h1 vs a compact bar). The title, subtitle,
 * breadcrumb and action slot live here so the pages only supply content —
 * and, via {@link ProjectSectionActions}, the controls that belong in this
 * header rather than a second one.
 */

import type { JSX } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, ChevronRight, FolderOpen, ListTodo, Mail, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { useInboundMailWaitingShown } from '@/hooks/use-inbound-mail-waiting'
import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { phoneBackTarget } from './phone-tabs'
import { SectionNav, type SectionNavItem } from './section-nav'
import { ShellSearchButton } from './shell-search-button'
import { SectionToolRow, SectionToolRowScope } from './section-tool-row'
import { CLAUSE_JOIN } from '@/lib/format'
import { cn } from '@/lib/utils'

const PROJECT_SECTION_KEYS = [
  'files',
  'automation',
  'referenzen',
  'settings',
  'knowledge',
  'intake',
  'setup',
  'members',
  'model',
  'research',
] as const

type ProjectChromeSection = (typeof PROJECT_SECTION_KEYS)[number]

const PROJECT_SECTION_KEY_SET: ReadonlySet<string> = new Set(PROJECT_SECTION_KEYS)

const FILL_SECTIONS: ReadonlySet<ProjectChromeSection> = new Set(['files', 'automation'])

// Not Dateien: its header names the open place under a crumb, and each place's list says what it holds.
const SUBTITLE_SECTIONS: ReadonlySet<ProjectChromeSection> = new Set([
  'automation',
  'knowledge',
  'settings',
  'intake',
  'setup',
])

/** Sections that draw their own chrome edge to edge. */
const BARE_SECTIONS: ReadonlySet<string> = new Set(['setup'])

const RETURN_TARGET_SECTIONS: ReadonlySet<ProjectChromeSection> = new Set(['members', 'model'])

/**
 * Pages inside a section: Dateien's places. The header names the open place
 * („E-Mail-Eingang“, 20/28/500) under a muted crumb of where it is („Projekt ›
 * Dateien“), and carries the places as tabs (Alle Dateien, E-Mail-Eingang,
 * Offene Punkte, Papierkorb), so a sub-page never draws a second title or its
 * own way back, and the E-Mail-Eingang is a place beside the files rather than a
 * link in a toolbar. No standing subtitle (paper on a desk, principle 8): each
 * place's list already says what it holds. The key is `<section>/<page>`, as in
 * `nav.subpages`.
 */
const SUBPAGES = ['files/mail', 'files/bin', 'files/open-points'] as const
type Subpage = (typeof SUBPAGES)[number]
const SUBPAGE_SET: ReadonlySet<string> = new Set(SUBPAGES)

function subpageOf(pathname: string): Subpage | null {
  const parts = pathname.split('/').filter(Boolean)
  const key = `${parts[3] ?? ''}/${parts[4] ?? ''}`
  return SUBPAGE_SET.has(key) ? (key as Subpage) : null
}

/**
 * The band a section's {@link PageHeader} sits in. Exported because the
 * Büroablage is a project's Dateien with the project taken out, and its header
 * is this one: one class, so the two stores cannot drift apart.
 */
// One rule under it: the header (title, places, tools) is one block and the listing another, and with white space
// alone the tools read as the listing's first row (review of 2026-11-11, „im Zweifelsfall wieder eine Outline an den
// unteren Rand“). It had one until 2026-11-10. The only rule Dateien draws between blocks (`tests/brand-literals.spec.ts`).
export const SECTION_HEADER_CLASS = 'shrink-0 border-b border-border bg-background px-4 py-4 phone:py-2 md:px-8'

const ActionsContext = createContext<(node: ReactNode, onTitleLine?: boolean) => void>(() => {})

// The tool row moved to its own module so the Büroablage can draw it too; its readers still import it from here.
export {
  ProjectSectionTabActions,
  SectionLevelTools,
  useInSectionToolRow,
  useSectionNewFolder,
  useSectionPrimaryYields,
  useSectionTabActionsSlot,
  useSectionToolTier,
  type SectionToolTier,
} from './section-tool-row'



function isProjectChromeSection(segment: string): segment is ProjectChromeSection {
  return PROJECT_SECTION_KEY_SET.has(segment)
}

/**
 * Whether the frame heads this page (every project page but the chat and the bare flows). Where it does, the page's
 * header carries the phone's way back and search, and the shell draws nothing above it (`AppSidebar`).
 */
export function framesProjectPage(pathname: string, projectId: string): boolean {
  return !isProjectChatPath(pathname, projectId) && !BARE_SECTIONS.has(projectSectionSegment(pathname))
}

function isProjectChatPath(pathname: string, projectId: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  return parts[0] === 'app' && parts[1] === 'projects' && parts[2] === projectId && parts[3] === 'chat'
}

/**
 * The project section a path is in: the segment right after the project id.
 *
 * Not the LAST segment. Settings has sub-routes (`/settings/members`), and
 * reading the tail titled that page as the legacy Members return target instead
 * of as Settings.
 */
function projectSectionSegment(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  return parts[3] ?? ''
}

/**
 * Portal the page's primary actions into {@link ProjectSectionFrame}'s header.
 * Renders nothing at the call site.
 */
export function ProjectSectionActions({
  children,
  onTitleLine = false,
}: {
  children: ReactNode
  /** On a phone too, the tools stand at the end of the title's line: for a page whose phone form is one ⋯. */
  onTitleLine?: boolean
}): null {
  const setActions = useContext(ActionsContext)
  useLayoutEffect(() => {
    setActions(children, onTitleLine)
    return () => setActions(null)
  }, [children, onTitleLine, setActions])
  return null
}

/** A page's own way back (an opened mail's, to its list), which the frame draws on a phone's title line. */
interface SectionBack {
  href: string
  /** The place it goes back to, as the reader knows it („E-Mail-Eingang“). */
  to: string
}
const BackContext = createContext<((back: SectionBack | null) => void) | null>(null)

/** Whether the frame draws {@link ProjectSectionBack} on a phone; outside it (a spec, a preview) the page keeps its own link there. */
export function useSectionBackSlot(): boolean {
  return useContext(BackContext) !== null
}

/**
 * Hand the page's way back to {@link ProjectSectionFrame}'s header: on a phone it is the ← that starts the title's
 * line, the page's one way back. Renders nothing at the call site.
 */
export function ProjectSectionBack({ href, to }: SectionBack): null {
  const setBack = useContext(BackContext)
  useLayoutEffect(() => {
    if (!setBack) return
    setBack({ href, to })
    return () => setBack(null)
  }, [href, to, setBack])
  return null
}

/**
 * Where the reader stands inside a place, when it is deeper than the place itself: Alle Dateien's open folder. The
 * title names it („Index C“, not „Alle Dateien“ over a folder's contents), the crumb carries the way there after the
 * project („Projekt › Dateien › Abgabepläne › …“, `trail`, each step a way up), and on a phone, which has no crumb,
 * the title's line starts with the way one level up (`up`). The tab still names the place.
 */
export interface SectionPlace {
  title: string
  /** The crumb after the project's name: the section's own step and the levels between it and `title`. */
  trail: ReactNode
  /** A phone's one-line crumb above the title, without the project: „… › Fluchtwegnachweise Tiefgarage“. */
  phoneTrail?: ReactNode
  /** One level up, for the phone's ← („Zurück zu Abgabepläne“). */
  up: { label: string; onSelect: () => void }
  /** What the level holds, beside the title in muted 13px („240 Elemente“): a folder of hundreds said nothing. */
  count?: string
}
const PlaceContext = createContext<((place: SectionPlace | null) => void) | null>(null)

/** Whether the frame draws {@link ProjectSectionPlace}; outside it (the Büroablage, a preview) the page keeps its own path row. */
export function useSectionPlaceSlot(): boolean {
  return useContext(PlaceContext) !== null
}

/** Hand the frame's title and crumb the level the reader stands in. Renders nothing at the call site. */
export function ProjectSectionPlace({ title, trail, phoneTrail, up, count }: SectionPlace): null {
  const setPlace = useContext(PlaceContext)
  useLayoutEffect(() => {
    if (!setPlace) return
    setPlace({ title, trail, phoneTrail, up, count })
    return () => setPlace(null)
  }, [title, trail, phoneTrail, up, count, setPlace])
  return null
}


/**
 * Shows what a page portals into the section header right above the page,
 * for a page rendered outside {@link ProjectSectionFrame}: a spec or a
 * `/dev` preview, which would otherwise lose the page's header actions.
 */
export function SectionActionsInline({ children }: { children: ReactNode }): JSX.Element {
  const [actions, setActionsNode] = useState<ReactNode>(null)
  const setActions = useCallback((node: ReactNode) => setActionsNode(node), [])
  return (
    <ActionsContext.Provider value={setActions}>
      {actions && <div data-testid="section-actions-inline">{actions}</div>}
      {children}
    </ActionsContext.Provider>
  )
}

/**
 * A folder's name as a title that may wrap: a break chance after each `_` and none after a `-`, read as the one
 * string it is. „Rauchabschnittsbildung_Bauteil_C_Index-“ over a lone „D“ was a phone's title line (dev, 2026-11-10).
 */
function BreakableName({ text }: { text: string }): JSX.Element {
  const parts = text.split('_')
  return (
    <>
      <span aria-hidden>
        {parts.map((part, index) => (
          <span key={index}>
            {(index < parts.length - 1 ? `${part}_` : part).replaceAll('-', '-\u2060')}
            {index < parts.length - 1 && <wbr />}
          </span>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </>
  )
}

/** Dateien's places as tabs, the E-Mail-Eingang only for whoever may decide the project's mail. */
function FilesTabs({ projectId, inboundMail, pathname }: { projectId: string; inboundMail: boolean; pathname: string }): JSX.Element {
  const t = useTranslations(navCopy)
  const waiting = useInboundMailWaitingShown(inboundMail ? projectId : null)
  const base = `/app/projects/${projectId}/files`
  const items: SectionNavItem[] = [
    // „Ordner“: true at every depth, and it goes to the top level from any folder (`base` has no `?folder=`).
    { key: 'files', href: base, icon: FolderOpen, label: t('subpages.files/all.tab') },
    ...(inboundMail
      ? [
          {
            key: 'mail',
            href: `${base}/mail`,
            icon: Mail,
            label: t('subpages.files/mail.title'),
            count: waiting.count,
            countLabel: waiting.count ? t('inboundMailWaiting', { count: waiting.count }) : undefined,
          },
        ]
      : []),
    { key: 'open-points', href: `${base}/open-points`, icon: ListTodo, label: t('subpages.files/open-points.title') },
    { key: 'bin', href: `${base}/bin`, icon: Trash2, label: t('subpages.files/bin.title') },
  ]
  // `pathname`: a preview renders a project page at its own URL, and the tabs read the path it heads.
  return (
    <SectionNav
      label={t('filesPlaces')}
      items={items}
      rootHref={base}
      pillId="files-places-pill"
      orientation="tabs"
      pathname={pathname}
      track
      compactOnPhone
      data-testid="files-tabs"
    />
  )
}

export function ProjectSectionFrame({
  projectId,
  projectName,
  children,
  pathname: pathnameOverride,
  inboundMail = false,
}: {
  projectId: string
  projectName: string
  children: ReactNode
  /** The path to head, for a `/dev` preview that renders a project page at its own URL. */
  pathname?: string
  /** The reader may decide the project's held mail (ADR-0137): Dateien shows the E-Mail-Eingang as a tab. */
  inboundMail?: boolean
}): JSX.Element {
  const currentPathname = usePathname()
  const pathname = pathnameOverride ?? currentPathname ?? ''
  const t = useTranslations(navCopy)
  const [{ node: actions, onTitleLine: actionsOnTitle }, setActionsState] = useState<{ node: ReactNode; onTitleLine: boolean }>({ node: null, onTitleLine: false })
  const setActions = useCallback((node: ReactNode, onTitleLine = false) => setActionsState({ node, onTitleLine }), [])
  const [pageBack, setPageBack] = useState<SectionBack | null>(null)
  const [placeState, setPlace] = useState<SectionPlace | null>(null)
  const phone = useMediaQuery(PHONE_QUERY)

  if (isProjectChatPath(pathname, projectId)) {
    return <>{children}</>
  }

  const segment = projectSectionSegment(pathname)
  // The setup draws its own bar and footer: one focused flow, no section head.
  if (BARE_SECTIONS.has(segment)) {
    return <div className="h-full min-h-0">{children}</div>
  }
  const known = isProjectChromeSection(segment)
  const sectionLabel = !known
    ? projectName
    : RETURN_TARGET_SECTIONS.has(segment)
      ? t(`returnTargets.${segment}`)
      : t(`sections.${segment}`)
  const files = segment === 'files'
  const sectionSubtitle = known && SUBTITLE_SECTIONS.has(segment) ? t(`sectionSubtitles.${segment}`) : undefined
  const fill = known && FILL_SECTIONS.has(segment)
  const subpage = subpageOf(pathname)
  // Below `md` there is no rail, and the page starts with its title: no project name stands above a phone page, as a
  // band or as a crumb (the founder, 2026-11-10: „it still looks weird, on mobile lets remove it entirely“). The
  // project is the first row of „Mehr“. The title's line holds the way back, where there is one, and the app's search.
  const shellBack = phoneBackTarget(pathname, projectId)
  const back = pageBack ?? (shellBack && { href: shellBack.href, to: t(`sections.${shellBack.sectionKey}`) })
  const allFiles = files && (subpage ?? 'files/all') === 'files/all'
  // The Ordner tab has its own search field right under its tabs: two magnifiers 100px apart asked which one to use.
  // The app's search is in „Mehr“ on every page.
  const ownSearch = allFiles
  const opened = files && pathname.split('/').filter(Boolean).length > 5
  const place = allFiles ? placeState : null
  // The Ordner tab's tools are a row of their own under its tabs, at every width: beside the title they wrapped into
  // three rows at 1440px under a long folder name. Another tab's one tool (the address, the Protokoll) stays on the
  // title's line, as a phone's ⋯ (`onTitleLine`).
  const toolRow = files && actions !== null && (phone ? !actionsOnTitle : allFiles)
  // At the top level the crumb is the project and the title „Dateien“; inside a folder the crumb is the way there
  // („Projekt › Dateien › …“) and the title the folder. „Alle Dateien“ over a subfolder named the wrong place.
  const title = place ? <BreakableName text={place.title} /> : allFiles ? t('sections.files') : files ? t(`subpages.${subpage}.title`) : sectionLabel
  const projectStep = <span className="max-w-[16rem] shrink-0 truncate" title={projectName}>{projectName}</span>

  return (
    <BackContext.Provider value={setPageBack}>
    <PlaceContext.Provider value={allFiles ? setPlace : null}>
    <ActionsContext.Provider value={setActions}>
    <SectionToolRowScope enabled={files && !phone}>
      <div className="@container/section flex h-full min-h-0 flex-col">
        {/* Every Dateien tab's head is the listing's container (1280px, 32px margins), centred with it from a 1440px
            section: the E-Mail-Eingang's split view sits in the same container, so no tab moves the title. */}
        <div className={cn(SECTION_HEADER_CLASS, 'phone:pt-3', files && '[&>*]:max-w-[1216px] @min-[90rem]/section:[&>*]:mx-auto')}>
          <PageHeader
            title={title}
            // Two lines at most, then cut at its end, the whole name its tooltip (a folder's name can be a sentence).
            titleClassName={files ? 'line-clamp-2' : undefined}
            titleTooltip={place ? [place.title, place.count].filter(Boolean).join(CLAUSE_JOIN) : undefined}
            titleAside={place?.count && <span className="text-muted-foreground text-[13px] leading-5 tabular-nums phone:hidden" data-testid="page-header-count">{place.count}</span>}
            crumb={
              files && !phone ? (
                <>
                  {projectStep}
                  {!(allFiles && !place) && <ChevronRight className="size-3 shrink-0" aria-hidden />}
                  {place ? place.trail : allFiles ? null : <span className="shrink-0">{sectionLabel}</span>}
                </>
              ) : files && place?.phoneTrail ? (
                place.phoneTrail
              ) : undefined
            }
            // At desk width only, but for a phone's way inside a folder: below `md` the page starts with its title.
            crumbClassName={phone ? 'text-[13px] leading-5' : 'max-md:hidden'}
            subtitle={sectionSubtitle}
            // One way back, on the title's line and its arrow on the title's edge: a page under the Übersicht goes
            // back to it, an opened mail to its list (`ProjectSectionBack`).
            titleStartClassName={pageBack || place ? 'hidden phone:flex' : 'md:hidden'}
            titleStart={
              place ? (
                // A folder's way up, on the phone's title line: the crumb says it at desk width.
                <button
                  type="button"
                  onClick={place.up.onSelect}
                  aria-label={place.up.label}
                  title={place.up.label}
                  data-testid="page-header-up"
                  className="text-foreground active:bg-desk -ml-3 -mr-2 flex size-11 items-center justify-center rounded-control"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                </button>
              ) : back && (
                <Link
                  href={back.href}
                  aria-label={t('backTo', { label: back.to })}
                  data-testid="page-header-back"
                  className={cn('text-foreground active:bg-desk -ml-3 -mr-2 flex size-11 items-center justify-center rounded-control', pageBack ? 'phone:flex hidden' : 'md:hidden')}
                >
                  <ArrowLeft className="size-4" aria-hidden />
                </Link>
              )
            }
            // The title's line ends in the app's search below `md` (not where the page has its own field). On a phone
            // a page whose tools fold into one ⋯ (`onTitleLine`) puts it there too: a row of its own under the tabs
            // cost 60px before the first mail or point.
            titleEnd={
              <>
                {!ownSearch && <ShellSearchButton className="-mr-2.5 md:hidden" />}
                {files && phone && actionsOnTitle ? actions : null}
              </>
            }
            action={files && (phone || allFiles) ? undefined : actions}
          />
          {files && (
            // On a phone an opened mail (`files/mail/<id>`) is a page of its own with its way back at its top: the
            // places would only push its subject below the fold. 24px under the title block (16px on a phone): at 12px
            // the places read as the title's last line (pilot feedback, 2026-11-10); the band keeps its own 16px.
            <div className={cn('-mb-2 mt-6 min-w-0 phone:mt-4', opened && 'phone:hidden')}>
              <FilesTabs projectId={projectId} inboundMail={inboundMail} pathname={pathname} />
            </div>
          )}
          {/* The tab's tools, on the title's left edge, one row that never wraps (`useSectionToolTier`). */}
          {toolRow && (
            <SectionToolRow className="mt-4">{actions}</SectionToolRow>
          )}
        </div>
        <div className={cn('min-h-0 flex-1', fill ? 'overflow-hidden pt-px' : 'overflow-y-auto')}>{children}</div>
      </div>
    </SectionToolRowScope>
    </ActionsContext.Provider>
    </PlaceContext.Provider>
    </BackContext.Provider>
  )
}
