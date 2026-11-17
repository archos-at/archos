import type { ComponentType } from 'react'
import { Archive, Bell, FolderKanban, MoreHorizontal } from 'lucide-react'

import { TOUR_ANCHORS, sectionAnchor } from '@/lib/onboarding/product-tour'
import {
  projectSection,
  sectionHref,
  sectionLinkHref,
  type ProjectSectionKey,
} from './project-sections'

export type PhoneTabKey = 'chat' | 'files' | 'settings' | 'inbox' | 'projects' | 'officeShelf' | 'more'

export interface PhoneTabLabel {
  namespace: 'nav' | 'collaboration'
  key: string
}

export interface PhoneTab {
  key: PhoneTabKey
  href: string | null
  icon: ComponentType<{ className?: string }>
  label: PhoneTabLabel
  active: boolean
  tourAnchor: string
}

export interface PhoneTabFlags {
  canAccessOfficeShelf: boolean
  canAccessInbox: boolean
}

const INBOX_HREF = '/app/inbox'
const OFFICE_SHELF_HREF = '/app/office-shelf'
const PROJECTS_HREF = '/app/projects'

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

const UNDER_OVERVIEW: readonly string[] = ['settings', 'setup', 'intake']

function projectTab(
  key: Extract<ProjectSectionKey, 'chat' | 'files' | 'settings'>,
  base: string,
  pathname: string
): PhoneTab {
  const section = projectSection(key)
  if (!section) throw new Error(`unknown project section: ${key}`)
  const active =
    key === 'settings'
      ? UNDER_OVERVIEW.some((segment) => isUnder(pathname, `${base}/${segment}`))
      : isUnder(pathname, sectionHref(section, base))
  return {
    key,
    href: sectionLinkHref(section, base),
    icon: section.icon,
    label: section.label ?? { namespace: 'nav', key: `sections.${section.i18nKey}` },
    active,
    tourAnchor: sectionAnchor(key),
  }
}

function inboxTab(pathname: string, tourAnchor: string): PhoneTab {
  return {
    key: 'inbox',
    href: INBOX_HREF,
    icon: Bell,
    label: { namespace: 'collaboration', key: 'inbox.navLabel' },
    active: isUnder(pathname, INBOX_HREF),
    tourAnchor,
  }
}

export function projectPhoneTabs(
  projectId: string,
  pathname: string,
  flags: PhoneTabFlags
): PhoneTab[] {
  const base = `/app/projects/${projectId}`
  const tabs: PhoneTab[] = [
    projectTab('chat', base, pathname),
    projectTab('files', base, pathname),
    projectTab('settings', base, pathname),
  ]
  if (flags.canAccessInbox) tabs.push(inboxTab(pathname, sectionAnchor('inbox')))
  const somewhereElse = !tabs.some((tab) => tab.active)
  tabs.push({
    key: 'more',
    href: null,
    icon: MoreHorizontal,
    label: { namespace: 'nav', key: 'tabBar.more' },
    active: somewhereElse,
    tourAnchor: TOUR_ANCHORS.more,
  })
  return tabs
}

export function orgPhoneTabs(pathname: string, flags: PhoneTabFlags): PhoneTab[] {
  const tabs: PhoneTab[] = [
    {
      key: 'projects',
      href: PROJECTS_HREF,
      icon: FolderKanban,
      label: { namespace: 'nav', key: 'projectSwitcher.projects' },
      active: pathname === PROJECTS_HREF,
      tourAnchor: 'tab-projects',
    },
  ]
  if (flags.canAccessOfficeShelf) {
    tabs.push({
      key: 'officeShelf',
      href: OFFICE_SHELF_HREF,
      icon: Archive,
      label: { namespace: 'nav', key: 'sections.officeShelf' },
      active: isUnder(pathname, OFFICE_SHELF_HREF),
      tourAnchor: TOUR_ANCHORS.officeShelf,
    })
  }
  if (flags.canAccessInbox) tabs.push(inboxTab(pathname, TOUR_ANCHORS.inbox))
  return tabs
}

export function phoneTabBarHiddenOnRoute(pathname: string): boolean {
  return /^\/app\/projects\/[^/]+\/intake(\/|$)/.test(pathname)
}

export interface PhoneBackTarget {
  href: string
  sectionKey: 'settings'
}

export function phoneBackTarget(pathname: string, projectId: string): PhoneBackTarget | null {
  const base = `/app/projects/${projectId}`
  if (pathname.startsWith(`${base}/settings/`))
    return { href: `${base}/settings`, sectionKey: 'settings' }
  if (isUnder(pathname, `${base}/setup`) || isUnder(pathname, `${base}/intake`)) {
    return { href: `${base}/settings`, sectionKey: 'settings' }
  }
  return null
}
