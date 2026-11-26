import { describe, expect, it } from 'vitest'

import { phoneBackTarget } from './phone-back'
import { projectSection } from './project-sections'

describe('the phone back button', () => {
  it('leads out of a page one level below a place', () => {
    expect(phoneBackTarget('/app/projects/p1/files/bin', 'p1')).toBeNull()
    expect(phoneBackTarget('/app/projects/p1/files/mail/m1', 'p1')).toBeNull()
    expect(phoneBackTarget('/app/projects/p1/settings/members', 'p1')).toEqual({
      href: '/app/projects/p1/settings',
      sectionKey: 'settings',
    })
    expect(phoneBackTarget('/app/projects/p1/setup', 'p1')).toEqual({
      href: '/app/projects/p1/settings',
      sectionKey: 'settings',
    })
  })

  it('is absent on a place of its own, where the menu is the way out', () => {
    for (const path of [
      '/app/projects/p1/chat',
      '/app/projects/p1/files',
      '/app/projects/p1/settings',
      '/app/projects/p1/automation',
    ]) {
      expect(phoneBackTarget(path, 'p1')).toBeNull()
    }
  })
})

describe('the Postfach looks like itself', () => {
  it('wears the bell, not the Bürobibliothek’s box', () => {
    expect(projectSection('inbox')?.icon).not.toBe(projectSection('officeShelf')?.icon)
    expect(projectSection('inbox')?.icon.displayName).toBe('Bell')
  })
})
