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
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
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

const SUBTITLE_SECTIONS: ReadonlySet<ProjectChromeSection> = new Set([
  'files',
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
 * Pages inside a section that head themselves through this frame: the page's
 * title and subtitle, with the section as the breadcrumb above („Dateien ›“).
 * One header, so a sub-page never draws a second title under the section's,
 * nor its own way back (the breadcrumb is it). The key is `<section>/<page>`,
 * as in `nav.subpages`.
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
export const SECTION_HEADER_CLASS = 'shrink-0 border-b border-border bg-background px-4 py-4 phone:py-2 md:px-8'

const ActionsContext = createContext<(node: ReactNode) => void>(() => {})

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

export function ProjectSectionFrame({
  projectId,
  projectName,
  children,
  pathname: pathnameOverride,
}: {
  projectId: string
  projectName: string
  children: ReactNode
  /** The path to head, for a `/dev` preview that renders a project page at its own URL. */
  pathname?: string
}): JSX.Element {
  const currentPathname = usePathname()
  const pathname = pathnameOverride ?? currentPathname ?? ''
  const t = useTranslations(navCopy)
  const [actions, setActions] = useState<ReactNode>(null)

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
  const sectionSubtitle = known && SUBTITLE_SECTIONS.has(segment) ? t(`sectionSubtitles.${segment}`) : undefined
  const fill = known && FILL_SECTIONS.has(segment)
  const subpage = subpageOf(pathname)

  return (
    <ActionsContext.Provider value={setActions}>
      <div className="flex h-full min-h-0 flex-col">
        <div className={SECTION_HEADER_CLASS}>
          {subpage ? (
            <div className="flex flex-col gap-1">
              <nav aria-label={t('breadcrumb')}>
                <Link
                  href={`/app/projects/${projectId}/${segment}`}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-sm text-xs transition-colors duration-quick ease-out motion-reduce:transition-none focus-visible:ring-ring/60 outline-none focus-visible:ring-2"
                  data-testid="section-breadcrumb"
                >
                  {sectionLabel}
                  <ChevronRight className="size-3" aria-hidden />
                </Link>
              </nav>
              <PageHeader title={t(`subpages.${subpage}.title`)} subtitle={t(`subpages.${subpage}.subtitle`)} action={actions} />
            </div>
          ) : (
            <PageHeader title={sectionLabel} subtitle={sectionSubtitle} action={actions} />
          )}
        </div>
        <div className={cn('min-h-0 flex-1', fill ? 'overflow-hidden' : 'overflow-y-auto')}>{children}</div>
      </div>
    </ActionsContext.Provider>
  )
}
