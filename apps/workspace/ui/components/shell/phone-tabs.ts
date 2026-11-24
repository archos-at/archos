import type { ComponentType } from 'react'
import { Bell, Folder, MoreHorizontal } from 'lucide-react'

import { TOUR_ANCHORS, sectionAnchor } from '@/lib/onboarding/product-tour'
import {
  projectSection,
  sectionHref,
  sectionLinkHref,
  type ProjectSectionKey,
} from './project-sections'
import { NEW_PERSONAL_CHAT_HREF, PERSONAL_CHAT_PATH, PERSONAL_SHELF_PATH } from './rail-mode'

export type PhoneTabKey = 'chat' | 'files' | 'settings' | 'inbox' | 'personalShelf' | 'more'

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

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

const UNDER_OVERVIEW: readonly string[] = ['settings', 'setup', 'intake']

/** A tab is a fifth of a 360px phone, 66px for its word: the rail's „Projekteinstellungen“ and "Documents" do not fit. */
const PHONE_SHORT_LABEL: Partial<Record<ProjectSectionKey, string>> = {
  settings: 'sections.settingsShort',
  files: 'sections.filesShort',
}

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
    label: section.label ?? { namespace: 'nav', key: PHONE_SHORT_LABEL[key] ?? `sections.${section.i18nKey}` },
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
  if (flags.canAccessInbox) tabs.push(inboxTab(pathname, TOUR_ANCHORS.inbox))
  return withMore(tabs)
}

function withMore(tabs: PhoneTab[]): PhoneTab[] {
  const somewhereElse = !tabs.some((tab) => tab.active)
  return [
    ...tabs,
    {
      key: 'more',
      href: null,
      icon: MoreHorizontal,
      label: { namespace: 'nav', key: 'tabBar.more' },
      active: somewhereElse,
      tourAnchor: TOUR_ANCHORS.more,
    },
  ]
}

export function personalPhoneTabs(pathname: string, flags: PhoneTabFlags): PhoneTab[] {
  const chat = projectSection('chat')
  if (!chat) throw new Error('unknown project section: chat')
  const tabs: PhoneTab[] = [
    {
      key: 'chat',
      href: NEW_PERSONAL_CHAT_HREF,
      icon: chat.icon,
      label: { namespace: 'nav', key: `sections.${chat.i18nKey}` },
      active: isUnder(pathname, PERSONAL_CHAT_PATH),
      tourAnchor: 'tab-personal-chat',
    },
    {
      key: 'personalShelf',
      href: PERSONAL_SHELF_PATH,
      icon: Folder,
      label: { namespace: 'nav', key: 'personalShelf' },
      active: isUnder(pathname, PERSONAL_SHELF_PATH),
      tourAnchor: 'tab-personal-shelf',
    },
  ]
  if (flags.canAccessInbox) tabs.push(inboxTab(pathname, TOUR_ANCHORS.inbox))
  return withMore(tabs)
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
