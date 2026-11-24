/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'

import { moreDestinations, type MoreFlags } from './phone-more'
import { personalPhoneTabs, projectPhoneTabs } from './phone-tabs'

const ALL: MoreFlags = {
  canAccessOfficeShelf: true,
  canAccessOfficeStandards: true,
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

  test.each(FLAG_SETS)('under Persönlich it never lists a destination the tab bar carries (%j)', (flags) => {
    const barHrefs = personalPhoneTabs('/app/profile', flags)
      .map((tab) => tab.href)
      .filter((href): href is string => href !== null)
      .map((href) => href.split('?')[0])
    for (const destination of moreDestinations(null, '/app/profile', flags)) {
      expect(barHrefs).not.toContain(destination.href)
    }
  })

  test('in a project it lists the rail sections without a tab, gated as the rail gates them', () => {
    const keys = (flags: MoreFlags) => moreDestinations('p1', '/app/projects/p1/chat', flags).map((d) => d.key)
    expect(keys(ALL)).toEqual(['automation', 'officeShelf', 'search', 'profile', 'memory', 'organization', 'platform', 'whats-new'])
    expect(keys(NONE)).toEqual(['search', 'profile', 'memory', 'whats-new'])
    expect(keys({ ...ALL, showSkills: false })).not.toContain('automation')
    expect(keys({ ...ALL, canAccessOfficeShelf: false })).not.toContain('officeShelf')
    expect(keys(ALL)).not.toContain('baseKnowledge')
  })

  test('groups the places as the rail does: the project’s, then the organisation’s', () => {
    const groups = Object.fromEntries(moreDestinations('p1', '/app/projects/p1/chat', ALL).map((d) => [d.key, d.group]))
    expect(groups).toMatchObject({ automation: 'project', officeShelf: 'organization', organization: 'account', profile: 'account', 'whats-new': 'help' })
  })

  test('the account links are gated as the avatar menu gates them', () => {
    const keys = (flags: Partial<MoreFlags>) =>
      moreDestinations(null, '/app/projects', { ...NONE, ...flags })
        .filter((d) => d.group === 'account' || d.group === 'help')
        .map((d) => d.key)
    expect(keys({})).toEqual(['profile', 'memory', 'whats-new'])
    expect(keys({ canViewOrganization: true })).toEqual(['profile', 'memory', 'organization', 'whats-new'])
    expect(keys({ canManageOrganization: true })).toEqual(['profile', 'memory', 'organization', 'whats-new'])
    expect(keys({ canManagePlatform: true })).toEqual(['profile', 'memory', 'platform', 'whats-new'])
  })
})

describe('moreDestinations under Persönlich (ADR-0193)', () => {
  test('lists the office’s places and the account, never a project’s', () => {
    const keys = moreDestinations(null, '/app/personal/chat', ALL).map((destination) => destination.key)
    expect(keys).toContain('officeShelf')
    expect(keys).toContain('profile')
    expect(keys).not.toContain('files')
    expect(keys).not.toContain('automation')
    expect(keys).not.toContain('knowledge')
  })

  test('never lists what the personal tab bar carries', () => {
    const keys = moreDestinations(null, '/app/personal-shelf', ALL).map((destination) => destination.key)
    expect(keys).not.toContain('inbox')
    expect(keys).not.toContain('personalShelf')
  })

  test('on a page with no side it lists what the side it keeps lists (ADR-0196)', () => {
    expect(moreDestinations(null, '/app/inbox', ALL).map((d) => d.key)).toEqual(moreDestinations(null, '/app/personal/chat', ALL).map((d) => d.key))
    expect(moreDestinations('p1', '/app/profile', ALL).map((d) => d.key)).toEqual(moreDestinations('p1', '/app/projects/p1/chat', ALL).map((d) => d.key))
  })
})
