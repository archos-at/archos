import type { ComponentType } from 'react'
import { Building2, ServerCog, Sparkles, UserRound } from 'lucide-react'

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

/**
 * What "Mehr" lists on a phone: the destinations the bottom tab bar does NOT
 * carry, and nothing it does.
 *
 * The drawer behind "Mehr" used to be the whole rail, so it repeated Frag
 * Piloti, Dateien, Übersicht and Postfach under the bar that already had them.
 * This is derived from the bar's own tab list (`projectPhoneTabs`,
 * `orgPhoneTabs`) and from the rail's own section list (`railSections`, the
 * same gates), so a destination added to the bar leaves this list by itself and
 * the two can never drift. `phone-more.spec.ts` pins it per scope.
 *
 * Groups as the rail groups them: `project` (the project's sections without a
 * tab: Automatisierung), `organization` (the organisation's doorways without a
 * tab: the Büroablage), `account` (the avatar menu's links, in the menu's
 * order and gated as the menu gates them) and `help` (Neuerungen, after the
 * tour, as the menu has it). Suche is not listed: the top band's search
 * reaches it, and twice was once too often. The project's and the
 * organisation's places stood in one „Bereiche" list, which the rail keeps
 * apart on purpose. Actions (theme, language, tour, feedback, sign out) are the sheet's
 * own and not destinations.
 */

export interface MoreDestination {
  key: string
  href: string
  icon: ComponentType<{ className?: string }>
  label: PhoneTabLabel
  group: 'project' | 'organization' | 'account' | 'help'
}

export interface MoreFlags extends PhoneTabFlags {
  showSkills: boolean
  canViewOrganization: boolean
  canManageOrganization: boolean
  canManagePlatform: boolean
}

/** Reached from the top band's search on a phone (`ShellSearchButton`), so not listed again. */
const ON_THE_BAND: ReadonlySet<string> = new Set(['search'])

/** The destination keys the bar carries, so a section with a tab never appears twice. */
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
  // Last, as in the avatar menu, after the places the account reaches.
  list.push({
    key: 'whats-new',
    href: '/app/whats-new',
    icon: Sparkles,
    label: { namespace: 'nav', key: 'userMenu.whatsNew' },
    group: 'help',
  })
  return list
}

/** The destinations "Mehr" lists inside a project (`projectId`) or above one (`null`). */
export function moreDestinations(projectId: string | null, pathname: string, flags: MoreFlags): MoreDestination[] {
  const account = accountDestinations(flags)
  if (projectId === null) return account
  const base = `/app/projects/${projectId}`
  const onBar = carried(projectPhoneTabs(projectId, pathname, flags))
  const sectionFlags: ProjectSectionFlags = {
    showSkills: flags.showSkills,
    canAccessOfficeShelf: flags.canAccessOfficeShelf,
    canAccessInbox: flags.canAccessInbox,
  }
  const places = railSections(sectionFlags)
    .filter((section) => !onBar.has(section.key) && !ON_THE_BAND.has(section.key))
    .map(
      (section): MoreDestination => ({
        key: section.key,
        href: section.href ?? sectionHref(section, base),
        icon: section.icon,
        label: section.label ?? { namespace: 'nav', key: `sections.${section.i18nKey}` },
        group: section.group === 'org' ? 'organization' : 'project',
      })
    )
  return [...places, ...account]
}

/** Which listed destination is the page the reader is on. */
export function isCurrentDestination(destination: MoreDestination, pathname: string): boolean {
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`)
}
