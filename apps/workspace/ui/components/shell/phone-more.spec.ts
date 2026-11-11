/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'

import { moreDestinations, type MoreFlags } from './phone-more'
import { orgPhoneTabs, projectPhoneTabs } from './phone-tabs'

const ALL: MoreFlags = {
  canAccessOfficeShelf: true,
  canAccessInbox: true,
  showSkills: true,
  canViewOrganization: true,
  canManageOrganization: true,
  canManagePlatform: true,
}
const NONE: MoreFlags = {
  canAccessOfficeShelf: false,
  canAccessInbox: false,
  showSkills: false,
  canViewOrganization: false,
  canManageOrganization: false,
  canManagePlatform: false,
}

const FLAG_SETS: MoreFlags[] = [ALL, NONE, { ...ALL, canAccessInbox: false }, { ...ALL, showSkills: false }]

describe('moreDestinations: what "Mehr" lists', () => {
  test.each(FLAG_SETS)('inside a project it never lists a destination the tab bar carries (%j)', (flags) => {
    const barHrefs = projectPhoneTabs('p1', '/app/projects/p1/files', flags)
      .map((tab) => tab.href)
      .filter((href): href is string => href !== null)
      .map((href) => href.split('?')[0])
    const listed = moreDestinations('p1', '/app/projects/p1/files', flags).map((d) => d.href)
    for (const href of listed) expect(barHrefs).not.toContain(href)
  })

  test.each(FLAG_SETS)('above a project it never lists an org tab-bar destination (%j)', (flags) => {
    const barHrefs = orgPhoneTabs('/app/projects', flags)
      .map((tab) => tab.href)
      .filter((href): href is string => href !== null)
    for (const destination of moreDestinations(null, '/app/projects', flags)) {
      expect(barHrefs).not.toContain(destination.href)
    }
  })

  test('in a project it lists the rail sections without a tab, gated as the rail gates them', () => {
    const keys = (flags: MoreFlags) => moreDestinations('p1', '/app/projects/p1/chat', flags).map((d) => d.key)
    // Suche is listed: the chat and Alle Dateien have no search on their title's line, so „Mehr“ is where it
    // is on every page.
    expect(keys(ALL)).toEqual(['automation', 'officeShelf', 'search', 'profile', 'organization', 'platform', 'whats-new'])
    expect(keys(NONE)).toEqual(['search', 'profile', 'whats-new'])
    expect(keys({ ...ALL, showSkills: false })).not.toContain('automation')
    expect(keys({ ...ALL, canAccessOfficeShelf: false })).not.toContain('officeShelf')
  })

  // The rail keeps the project's sections and the organisation's doorways
  // apart; „Mehr" listed them in one „Bereiche" group.
  test('groups the places as the rail does: the project’s, then the organisation’s', () => {
    const groups = Object.fromEntries(moreDestinations('p1', '/app/projects/p1/chat', ALL).map((d) => [d.key, d.group]))
    expect(groups).toMatchObject({ automation: 'project', officeShelf: 'organization', organization: 'account', profile: 'account', 'whats-new': 'help' })
  })

  test('the account links are gated as the avatar menu gates them', () => {
    const keys = (flags: Partial<MoreFlags>) => moreDestinations(null, '/app/projects', { ...NONE, ...flags }).map((d) => d.key)
    expect(keys({})).toEqual(['profile', 'whats-new'])
    expect(keys({ canViewOrganization: true })).toEqual(['profile', 'organization', 'whats-new'])
    expect(keys({ canManageOrganization: true })).toEqual(['profile', 'organization', 'whats-new'])
    expect(keys({ canManagePlatform: true })).toEqual(['profile', 'platform', 'whats-new'])
  })
})
