import type { ComponentType } from 'react'
import { Brain, Building2, ServerCog, Sparkles, UserRound } from 'lucide-react'

import {
  railSections,
  sectionHref,
  type ProjectSectionFlags,
} from './project-sections'
import {
  projectPhoneTabs,
  type PhoneTab,
  type PhoneTabFlags,
  type PhoneTabLabel,
} from './phone-tabs'

export interface MoreDestination {
  key: string
  href: string
  icon: ComponentType<{ className?: string }>
  label: PhoneTabLabel
  group: 'project' | 'organization' | 'account' | 'help'
}

export interface MoreFlags extends PhoneTabFlags {
  showSkills: boolean
  canAccessOfficeStandards?: boolean
  canViewOrganization: boolean
  canManageOrganization: boolean
  canManagePlatform: boolean
}

const GROUP_ORDER: readonly MoreDestination['group'][] = ['project', 'organization', 'account', 'help']

function carried(tabs: readonly PhoneTab[]): ReadonlySet<string> {
  return new Set(tabs.filter((tab) => tab.href !== null).map((tab) => tab.key))
}

function accountDestinations(flags: MoreFlags): MoreDestination[] {
  const list: MoreDestination[] = [
    {
      key: 'profile',
      href: '/app/profile',
      icon: UserRound,
      label: { namespace: 'nav', key: 'userMenu.profile' },
      group: 'account',
    },
    {
      key: 'memory',
      href: '/app/memory',
      icon: Brain,
      label: { namespace: 'nav', key: 'userMenu.memory' },
      group: 'account',
    },
  ]
  if (flags.canViewOrganization || flags.canManageOrganization) {
    list.push({
      key: 'organization',
      href: '/app/organization',
      icon: Building2,
      label: { namespace: 'nav', key: 'userMenu.organization' },
      group: 'account',
    })
  }
  if (flags.canManagePlatform) {
    list.push({
      key: 'platform',
      href: '/app/platform',
      icon: ServerCog,
      label: { namespace: 'nav', key: 'userMenu.platform' },
      group: 'account',
    })
  }
  list.push({
    key: 'whats-new',
    href: '/app/whats-new',
    icon: Sparkles,
    label: { namespace: 'nav', key: 'userMenu.whatsNew' },
    group: 'help',
  })
  return list
}

export function moreDestinations(projectId: string | null, pathname: string, flags: MoreFlags): MoreDestination[] {
  const account = accountDestinations(flags)
  if (projectId === null) return account
  const base = `/app/projects/${projectId}`
  const onBar = carried(projectPhoneTabs(projectId, pathname, flags))
  const sectionFlags: ProjectSectionFlags = {
    showSkills: flags.showSkills,
    canAccessOfficeShelf: flags.canAccessOfficeShelf,
    canAccessOfficeStandards: flags.canAccessOfficeStandards,
    canAccessInbox: flags.canAccessInbox,
  }
  const places = railSections(sectionFlags)
    .filter((section) => !onBar.has(section.key))
    .map(
      (section): MoreDestination => ({
        key: section.key,
        href: section.href ?? sectionHref(section, base),
        icon: section.icon,
        label: section.label ?? { namespace: 'nav', key: `sections.${section.i18nKey}` },
        group: section.group === 'org' ? 'organization' : 'project',
      })
    )
  return [...places, ...account].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
}

export function isCurrentDestination(destination: MoreDestination, pathname: string): boolean {
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`)
}
