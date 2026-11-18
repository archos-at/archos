'use client'

import type { JSX } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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
import { SECTION_CONTENT_WIDTH } from './section-layout'
import { SectionToolRow, SectionToolRowScope } from './section-tool-row'
import { PlaceContext, SectionPlaceUp, type SectionPlace } from './section-place'
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

const SUBTITLE_SECTIONS: ReadonlySet<ProjectChromeSection> = new Set(['knowledge', 'intake', 'setup'])

const BARE_SECTIONS: ReadonlySet<string> = new Set(['setup'])

const RETURN_TARGET_SECTIONS: ReadonlySet<ProjectChromeSection> = new Set(['members', 'model'])

const SUBPAGES = ['files/mail', 'files/bin', 'files/open-points'] as const
type Subpage = (typeof SUBPAGES)[number]
const SUBPAGE_SET: ReadonlySet<string> = new Set(SUBPAGES)

function subpageOf(pathname: string): Subpage | null {
  const parts = pathname.split('/').filter(Boolean)
  const key = `${parts[3] ?? ''}/${parts[4] ?? ''}`
  return SUBPAGE_SET.has(key) ? (key as Subpage) : null
}

export const SECTION_HEADER_CLASS = 'shrink-0 border-b border-border bg-background px-4 py-4 phone:py-2 md:px-8'

export { SECTION_CONTENT_WIDTH, SECTION_READING_COLUMN } from './section-layout'

const ActionsContext = createContext<(node: ReactNode, onTitleLine?: boolean) => void>(() => {})

const TabsSlotContext = createContext<HTMLElement | null | undefined>(undefined)

export function ProjectSectionTabs({ children }: { children: ReactNode }): ReactNode {
  const slot = useContext(TabsSlotContext)
  if (slot === undefined) return children
  return slot ? createPortal(children, slot) : null
}

export { ProjectSectionPlace, useSectionPlaceSlot, type SectionPlace } from './section-place'
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

export function framesProjectPage(pathname: string, projectId: string): boolean {
  return !isProjectChatPath(pathname, projectId) && !BARE_SECTIONS.has(projectSectionSegment(pathname))
}

function isProjectChatPath(pathname: string, projectId: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  return parts[0] === 'app' && parts[1] === 'projects' && parts[2] === projectId && parts[3] === 'chat'
}

function projectSectionSegment(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  return parts[3] ?? ''
}

export function ProjectSectionActions({
  children,
  onTitleLine = false,
}: {
  children: ReactNode
  onTitleLine?: boolean
}): null {
  const setActions = useContext(ActionsContext)
  useLayoutEffect(() => {
    setActions(children, onTitleLine)
    return () => setActions(null)
  }, [children, onTitleLine, setActions])
  return null
}

interface SectionBack {
  href: string
  to: string
}
const BackContext = createContext<((back: SectionBack | null) => void) | null>(null)

export function useSectionBackSlot(): boolean {
  return useContext(BackContext) !== null
}

export function ProjectSectionBack({ href, to }: SectionBack): null {
  const setBack = useContext(BackContext)
  useLayoutEffect(() => {
    if (!setBack) return
    setBack({ href, to })
    return () => setBack(null)
  }, [href, to, setBack])
  return null
}



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

function FilesTabs({ projectId, inboundMail, pathname }: { projectId: string; inboundMail: boolean; pathname: string }): JSX.Element {
  const t = useTranslations(navCopy)
  const waiting = useInboundMailWaitingShown(inboundMail ? projectId : null)
  const base = `/app/projects/${projectId}/files`
  const items: SectionNavItem[] = [
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
  pathname?: string
  inboundMail?: boolean
}): JSX.Element {
  const currentPathname = usePathname()
  const pathname = pathnameOverride ?? currentPathname ?? ''
  const t = useTranslations(navCopy)
  const [{ node: actions, onTitleLine: actionsOnTitle }, setActionsState] = useState<{ node: ReactNode; onTitleLine: boolean }>({ node: null, onTitleLine: false })
  const setActions = useCallback((node: ReactNode, onTitleLine = false) => setActionsState({ node, onTitleLine }), [])
  const [pageBack, setPageBack] = useState<SectionBack | null>(null)
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null)
  const [placeState, setPlace] = useState<SectionPlace | null>(null)
  const phone = useMediaQuery(PHONE_QUERY)

  if (isProjectChatPath(pathname, projectId)) {
    return <>{children}</>
  }

  const segment = projectSectionSegment(pathname)
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
  const shellBack = phoneBackTarget(pathname, projectId)
  const back = pageBack ?? (shellBack && { href: shellBack.href, to: t(`sections.${shellBack.sectionKey}`) })
  const allFiles = files && (subpage ?? 'files/all') === 'files/all'
  const ownSearch = allFiles
  const opened = files && pathname.split('/').filter(Boolean).length > 5
  const place = allFiles ? placeState : null
  const toolRow = files && actions !== null && (phone ? !actionsOnTitle : allFiles)
  const title = place ? <BreakableName text={place.title} /> : allFiles ? t('sections.files') : files ? t(`subpages.${subpage}.title`) : sectionLabel
  const projectStep = <span className="max-w-[16rem] shrink-0 truncate" title={projectName}>{projectName}</span>

  return (
    <BackContext.Provider value={setPageBack}>
    <PlaceContext.Provider value={allFiles ? setPlace : null}>
    <ActionsContext.Provider value={setActions}>
    <TabsSlotContext.Provider value={tabsSlot}>
    <SectionToolRowScope enabled={files && !phone}>
      <div className="@container/section flex h-full min-h-0 flex-col">
        {/* Every section's head is the design system's content container (1280px, 32px margins, `listing-container`),
            centred with it from a 1440px section, and so is every section's page: the title stands on the content's
            left edge on every page. Only Dateien had it; the Übersicht's title stood at the screen's edge over a page
            centred at 1152px (review of 2026-11-11). The band and its rule run the section's width. */}
        <div className={cn(SECTION_HEADER_CLASS, 'phone:pt-3', SECTION_CONTENT_WIDTH)}>
          <PageHeader
            title={title}
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
              ) : known && !phone ? (
                projectStep
              ) : undefined
            }
            crumbClassName={phone ? 'text-[13px] leading-5' : 'max-md:hidden'}
            subtitle={sectionSubtitle}
            titleStartClassName={place ? undefined : pageBack ? 'hidden phone:flex' : 'md:hidden'}
            titleStart={
              place ? (
                <SectionPlaceUp up={place.up} />
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
            titleEnd={
              <>
                {!ownSearch && <ShellSearchButton className="-mr-2.5 md:hidden" />}
                {files && phone && actionsOnTitle ? actions : null}
              </>
            }
            action={files && (phone || allFiles) ? undefined : actions}
          />
          {files && (
            <div className={cn('-mb-2 mt-6 min-w-0 phone:mt-4', opened && 'phone:hidden')}>
              <FilesTabs projectId={projectId} inboundMail={inboundMail} pathname={pathname} />
            </div>
          )}
          {/* Another section's own places (`ProjectSectionTabs`), where Dateien's stand; nothing where it has none. */}
          {!files && <div ref={setTabsSlot} className="-mb-2 mt-6 min-w-0 empty:hidden phone:mt-4" data-testid="section-tabs-slot" />}
          {/* The tab's tools, on the title's left edge, one row that never wraps (`useSectionToolTier`). */}
          {toolRow && (
            <SectionToolRow className="mt-4">{actions}</SectionToolRow>
          )}
        </div>
        <div className={cn('min-h-0 flex-1', fill ? 'overflow-hidden pt-px' : 'overflow-y-auto')}>{children}</div>
      </div>
    </SectionToolRowScope>
    </TabsSlotContext.Provider>
    </ActionsContext.Provider>
    </PlaceContext.Provider>
    </BackContext.Provider>
  )
}
