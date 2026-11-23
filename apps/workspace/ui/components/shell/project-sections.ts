import type { ComponentType } from 'react'
import {
  Archive,
  Library,
  BookOpenCheck,
  ClipboardList,
  Bell,
  Folder,
  MessageSquare,
  LayoutDashboard,
  Search,
  Zap,
} from 'lucide-react'

export type ProjectSectionKey =
  | 'chat'
  | 'automation'
  | 'files'
  | 'knowledge'
  | 'officeShelf'
  | 'baseKnowledge'
  | 'search'
  | 'inbox'
  | 'intake'
  | 'settings'

export type ProjectNavGroup = 'work' | 'org'

export interface ProjectSectionFlags {
  showSkills?: boolean
  canAccessOfficeShelf?: boolean
  canAccessOfficeStandards?: boolean
  showKnowledge?: boolean
  canCollaborate?: boolean
  canAccessInbox?: boolean
  showModels?: boolean
}

export interface ProjectSection {
  key: ProjectSectionKey
  segment: string | null
  href?: string
  icon: ComponentType<{ className?: string }>
  i18nKey: string
  label?: { namespace: 'collaboration'; key: string }
  gate?: keyof ProjectSectionFlags
  inRail: boolean
  inPalette: boolean
  shortcutKey?: string
  group?: ProjectNavGroup
  alsoActiveOn?: readonly string[]
}

const PROJECT_SECTIONS: readonly ProjectSection[] = [
  {
    key: 'chat',
    segment: 'chat',
    icon: MessageSquare,
    i18nKey: 'chat',
    inRail: true,
    inPalette: true,
    shortcutKey: 'c',
    group: 'work',
  },
  {
    key: 'files',
    segment: 'files',
    icon: Folder,
    i18nKey: 'files',
    inRail: true,
    inPalette: true,
    shortcutKey: 'f',
    group: 'work',
  },
  {
    key: 'knowledge',
    segment: 'knowledge',
    icon: BookOpenCheck,
    i18nKey: 'knowledge',
    gate: 'showKnowledge',
    inRail: false,
    inPalette: true,
    shortcutKey: 'k',
  },
  {
    key: 'automation',
    segment: 'automation',
    icon: Zap,
    i18nKey: 'automation',
    gate: 'showSkills',
    inRail: true,
    inPalette: true,
    shortcutKey: 'j',
    group: 'work',
  },
  {
    key: 'officeShelf',
    segment: null,
    href: '/app/office-shelf',
    icon: Archive,
    i18nKey: 'officeShelf',
    gate: 'canAccessOfficeShelf',
    alsoActiveOn: ['/app/base-knowledge'],
    inRail: true,
    inPalette: true,
    shortcutKey: 'a',
    group: 'org',
  },
  {
    key: 'baseKnowledge',
    segment: null,
    href: '/app/base-knowledge',
    icon: Library,
    i18nKey: 'baseKnowledge',
    gate: 'canAccessOfficeStandards',
    inRail: false,
    inPalette: true,
    shortcutKey: 'n',
    group: 'org',
  },
  {
    key: 'search',
    segment: null,
    href: '/app/search',
    icon: Search,
    i18nKey: 'search',
    inRail: true,
    inPalette: true,
    shortcutKey: 'u',
    group: 'org',
  },
  {
    key: 'inbox',
    segment: null,
    href: '/app/inbox',
    icon: Bell,
    i18nKey: 'inbox',
    label: { namespace: 'collaboration', key: 'inbox.navLabel' },
    gate: 'canAccessInbox',
    inRail: true,
    inPalette: false,
    shortcutKey: 'i',
    group: 'org',
  },
  {
    key: 'intake',
    segment: 'intake',
    icon: ClipboardList,
    i18nKey: 'intake',
    inRail: false,
    inPalette: true,
  },
]

export const PROJECT_SETTINGS_SECTION: ProjectSection = {
  key: 'settings',
  segment: 'settings',
  icon: LayoutDashboard,
  i18nKey: 'settings',
  inRail: true,
  inPalette: true,
  shortcutKey: 's',
}

export function sectionHref(section: ProjectSection, base: string): string {
  return section.href ?? `${base}/${section.segment}`
}

export function isSectionPathActive(section: ProjectSection, base: string, pathname: string): boolean {
  return [sectionHref(section, base), ...(section.alsoActiveOn ?? [])].some((href) => pathname.startsWith(href))
}

export function sectionLinkHref(section: ProjectSection, base: string): string {
  const href = sectionHref(section, base)
  return section.key === 'chat' ? `${href}?new=1` : href
}

export function projectSection(key: ProjectSectionKey): ProjectSection | undefined {
  return key === 'settings' ? PROJECT_SETTINGS_SECTION : PROJECT_SECTIONS.find((section) => section.key === key)
}

function isVisible(section: ProjectSection, flags: ProjectSectionFlags): boolean {
  return section.gate ? Boolean(flags[section.gate]) : true
}

export function railSections(flags: ProjectSectionFlags): ProjectSection[] {
  return PROJECT_SECTIONS.filter((section) => section.inRail && isVisible(section, flags))
}

export function railGroups(flags: ProjectSectionFlags): { group: ProjectNavGroup; items: ProjectSection[] }[] {
  const groups: { group: ProjectNavGroup; items: ProjectSection[] }[] = []
  for (const item of railSections(flags)) {
    const { group } = item
    if (!group) continue
    const last = groups.at(-1)
    if (last?.group === group) {
      last.items.push(item)
    } else {
      groups.push({ group, items: [item] })
    }
  }
  return groups
}

export function paletteSections(flags: ProjectSectionFlags): ProjectSection[] {
  return [...PROJECT_SECTIONS, PROJECT_SETTINGS_SECTION].filter(
    (section) => section.inPalette && isVisible(section, flags),
  )
}

export function jumpSections(flags: ProjectSectionFlags): ProjectSection[] {
  return [...PROJECT_SECTIONS, PROJECT_SETTINGS_SECTION].filter(
    (section) => section.shortcutKey && isVisible(section, flags),
  )
}
