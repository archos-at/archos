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
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { ChevronRight, FolderOpen, ListTodo, Mail, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { useInboundMailWaitingShown } from '@/hooks/use-inbound-mail-waiting'
import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { SectionNav, type SectionNavItem } from './section-nav'
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
 * („E-Mail-Eingang“, 24/32/600) under a muted crumb of where it is („Projekt ›
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
// No line under it (the design system: none under the header): white space and the content's own start separate it.
export const SECTION_HEADER_CLASS = 'shrink-0 bg-background px-4 py-4 phone:py-2 md:px-8'

const ActionsContext = createContext<(node: ReactNode) => void>(() => {})

/**
 * The end of the tabs row, for the tools of the level a tab shows (Dateien's
 * „Auswählen“ and „Ordner anlegen“ at the root): null where there is no such
 * row (a phone, a page outside the frame), and the caller keeps them inline.
 */
const TabActionsContext = createContext<((node: ReactNode) => void) | null>(null)

function isProjectChromeSection(segment: string): segment is ProjectChromeSection {
  return PROJECT_SECTION_KEY_SET.has(segment)
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
export function ProjectSectionActions({ children }: { children: ReactNode }): null {
  const setActions = useContext(ActionsContext)
  useLayoutEffect(() => {
    setActions(children)
    return () => setActions(null)
  }, [children, setActions])
  return null
}

/** Whether {@link ProjectSectionTabActions} has a row to go to; where not, the caller renders its tools itself. */
export function useSectionTabActionsSlot(): boolean {
  return useContext(TabActionsContext) !== null
}

/**
 * Portal a tab's level tools to the end of its tabs row. At the root of
 * Dateien the path row held only these two presses, a row of its own above
 * the brief; beside the tab that names the level they cost no row. Renders
 * nothing at the call site.
 */
export function ProjectSectionTabActions({ children }: { children: ReactNode }): null {
  const setTabActions = useContext(TabActionsContext)
  useLayoutEffect(() => {
    if (!setTabActions) return
    setTabActions(children)
    return () => setTabActions(null)
  }, [children, setTabActions])
  return null
}

/**
 * Shows what a page portals into the section header right above the page,
 * for a page rendered outside {@link ProjectSectionFrame}: a spec or a
 * `/dev` preview, which would otherwise lose the page's header actions.
 */
export function SectionActionsInline({ children }: { children: ReactNode }): JSX.Element {
  const [actions, setActions] = useState<ReactNode>(null)
  return (
    <ActionsContext.Provider value={setActions}>
      {actions && <div data-testid="section-actions-inline">{actions}</div>}
      {children}
    </ActionsContext.Provider>
  )
}

/** Dateien's places as tabs, the E-Mail-Eingang only for whoever may decide the project's mail. */
function FilesTabs({ projectId, inboundMail, pathname }: { projectId: string; inboundMail: boolean; pathname: string }): JSX.Element {
  const t = useTranslations(navCopy)
  const waiting = useInboundMailWaitingShown(inboundMail ? projectId : null)
  const base = `/app/projects/${projectId}/files`
  const items: SectionNavItem[] = [
    { key: 'files', href: base, icon: FolderOpen, label: t('subpages.files/all.title') },
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
  const [actions, setActions] = useState<ReactNode>(null)
  const [tabActions, setTabActions] = useState<ReactNode>(null)
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

  return (
    <ActionsContext.Provider value={setActions}>
    <TabActionsContext.Provider value={segment === 'files' && !phone ? setTabActions : null}>
      <div className="@container/section flex h-full min-h-0 flex-col">
        {/* Every Dateien tab's head is the listing's container (1280px, 32px margins), centred with it from a 1440px
            section: the E-Mail-Eingang's split view sits in the same container, so no tab moves the title. */}
        <div className={cn(SECTION_HEADER_CLASS, segment === 'files' && '[&>*]:max-w-[1216px] @min-[90rem]/section:[&>*]:mx-auto')}>
          {/* On a phone Dateien's places sit right under the title on every tab, and a tab's own tools (the
              search, the filter) come below them: above them, the tabs moved down on „Alle Dateien“ and up in
              the E-Mail-Eingang, which has none. */}
          <PageHeader
            title={files ? t(`subpages.${subpage ?? 'files/all'}.title`) : sectionLabel}
            crumb={
              files ? (
                <>
                  <span className="min-w-0 truncate">{projectName}</span>
                  <ChevronRight className="size-3 shrink-0 phone:hidden" aria-hidden />
                  <span className="shrink-0 phone:hidden">{sectionLabel}</span>
                </>
              ) : undefined
            }
            subtitle={sectionSubtitle}
            action={files && phone ? undefined : actions}
          />
          {segment === 'files' && (
            // On a phone an opened mail (`files/mail/<id>`) is a page of its own with its way back at its top: the
            // places would only push its subject below the fold.
            <div className={cn('-mb-2 mt-3 flex items-start justify-between gap-4 phone:mt-2', pathname.split('/').filter(Boolean).length > 5 && 'phone:hidden')}>
              {/* The track on the title's edge: a fill always drawn is the edge, not given back. */}
              <div className="min-w-0">
                <FilesTabs projectId={projectId} inboundMail={inboundMail} pathname={pathname} />
              </div>
              {/* The tabs' own 8px under the track, so the tools stand on the track's line. */}
              {/* At the tabs' 14px: one size for the band, the tabs' and their tools'. */}
              {/* Tonal presses 12px apart, as every bar's, the last one's fill on the content edge. */}
              {tabActions && <div className="flex shrink-0 items-center gap-3 pb-2 [&_[data-slot=button]]:text-sm">{tabActions}</div>}
            </div>
          )}
          {segment === 'files' && phone && actions && <div className="mt-4 min-w-0">{actions}</div>}
        </div>
        <div className={cn('min-h-0 flex-1', fill ? 'overflow-hidden' : 'overflow-y-auto')}>{children}</div>
      </div>
    </TabActionsContext.Provider>
    </ActionsContext.Provider>
  )
}
