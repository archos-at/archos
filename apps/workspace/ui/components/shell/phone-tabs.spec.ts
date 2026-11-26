/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  personalPhoneTabs,
  phoneBackTarget,
  phoneTabBarHiddenOnRoute,
  projectPhoneTabs,
} from './phone-tabs'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { navCopy } from '@/i18n/namespaces/nav'
import { projectSection } from './project-sections'

const ALL = { canAccessOfficeShelf: true, canAccessInbox: true }
const NONE = { canAccessOfficeShelf: false, canAccessInbox: false }
const keys = (tabs: { key: string }[]): string[] => tabs.map((tab) => tab.key)
const lit = (tabs: { key: string; active: boolean }[]): string[] =>
  tabs.filter((tab) => tab.active).map((tab) => tab.key)

describe('inside a project', () => {
  it('carries the two work surfaces, the Übersicht, the Postfach and "Mehr", in that order', () => {
    expect(keys(projectPhoneTabs('p1', '/app/projects/p1/chat', ALL))).toEqual([
      'chat',
      'files',
      'settings',
      'inbox',
      'more',
    ])
  })

  it('on the chat route, "Mehr" is there: the door to its sheet, since chat has no menu button of its own', () => {
    const more = projectPhoneTabs('p1', '/app/projects/p1/chat', NONE).find((tab) => tab.key === 'more')
    expect(more).toMatchObject({ href: null })
    expect(phoneTabBarHiddenOnRoute('/app/projects/p1/chat')).toBe(false)
  })

  it('drops the Postfach for a reader without one, and keeps "Mehr" last', () => {
    expect(keys(projectPhoneTabs('p1', '/app/projects/p1/chat', NONE))).toEqual([
      'chat',
      'files',
      'settings',
      'more',
    ])
  })

  it('links the chat tab back to the chat the person left, and the rest where the rail links', () => {
    const hrefs = Object.fromEntries(
      projectPhoneTabs('p1', '/app/projects/p1/files', ALL).map((tab) => [tab.key, tab.href])
    )
    expect(hrefs).toEqual({
      chat: '/app/projects/p1/chat',
      files: '/app/projects/p1/files',
      settings: '/app/projects/p1/settings',
      inbox: '/app/inbox',
      more: null,
    })
  })

  it('lights exactly one tab', () => {
    expect(lit(projectPhoneTabs('p1', '/app/projects/p1/chat/s-9', ALL))).toEqual(['chat'])
    expect(lit(projectPhoneTabs('p1', '/app/projects/p1/files/bin', ALL))).toEqual(['files'])
    expect(lit(projectPhoneTabs('p1', '/app/inbox', ALL))).toEqual(['inbox'])
  })

  it('keeps the Übersicht lit on its own setup pages', () => {
    for (const path of [
      '/app/projects/p1/settings',
      '/app/projects/p1/settings/members',
      '/app/projects/p1/setup',
    ]) {
      expect(lit(projectPhoneTabs('p1', path, ALL))).toEqual(['settings'])
    }
  })

  it('lights "Mehr" where only its sheet reaches', () => {
    expect(lit(projectPhoneTabs('p1', '/app/projects/p1/automation', ALL))).toEqual(['more'])
    expect(lit(projectPhoneTabs('p1', '/app/office-shelf', ALL))).toEqual(['more'])
  })

  it('names each tab with the rail label (the files and settings tabs with their short ones), and marks it as a tour stop', () => {
    const [chat, files, settings, inbox, more] = projectPhoneTabs(
      'p1',
      '/app/projects/p1/chat',
      ALL
    )
    expect(chat).toMatchObject({
      label: { namespace: 'nav', key: 'sections.chat' },
      tourAnchor: 'section-chat',
    })
    expect(files).toMatchObject({
      label: { namespace: 'nav', key: 'sections.filesShort' },
      tourAnchor: 'section-files',
    })
    expect(settings).toMatchObject({
      label: { namespace: 'nav', key: 'sections.settingsShort' },
      tourAnchor: 'section-settings',
    })
    expect(inbox).toMatchObject({ label: { namespace: 'collaboration', key: 'inbox.navLabel' } })
    expect(more).toMatchObject({
      label: { namespace: 'nav', key: 'tabBar.more' },
      tourAnchor: 'tab-more',
    })
  })
})

describe('on a page with no side of its own (ADR-0196)', () => {
  it('keeps the side’s tabs, lights the Postfach on the Postfach, and „Mehr“ on what „Mehr“ leads to', () => {
    expect(lit(projectPhoneTabs('p1', '/app/inbox', ALL))).toEqual(['inbox'])
    expect(lit(projectPhoneTabs('p1', '/app/office-shelf', ALL))).toEqual(['more'])
    expect(lit(personalPhoneTabs('/app/profile', ALL))).toEqual(['more'])
  })

  it('points the welcome tour at the Postfach on either side', () => {
    expect(projectPhoneTabs('p1', '/app/projects', ALL).find((tab) => tab.key === 'inbox')?.tourAnchor).toBe('inbox')
    expect(personalPhoneTabs('/app/projects', ALL).find((tab) => tab.key === 'inbox')?.tourAnchor).toBe('inbox')
  })
})

describe('where the bar stands down', () => {
  it('on the intake wizard, which has its own footer', () => {
    expect(phoneTabBarHiddenOnRoute('/app/projects/p1/intake')).toBe(true)
    expect(phoneTabBarHiddenOnRoute('/app/projects/p1/intake/step-2')).toBe(true)
  })

  it('nowhere else, chat included', () => {
    for (const path of [
      '/app/projects',
      '/app/projects/p1/chat',
      '/app/projects/p1/files',
      '/app/profile',
    ]) {
      expect(phoneTabBarHiddenOnRoute(path)).toBe(false)
    }
  })
})

describe('the phone header back', () => {
  it('leads out of a page one level below a tab', () => {
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

  it('is absent on a tab root, where the bar is the way out', () => {
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
  it('wears one glyph everywhere, and not the Bürobibliothek’s box beside it', () => {
    const inboxTab = projectPhoneTabs('p1', '/app/projects', ALL).find((tab) => tab.key === 'inbox')
    expect(inboxTab?.icon).toBe(projectSection('inbox')?.icon)
    expect(projectSection('inbox')?.icon).not.toBe(projectSection('officeShelf')?.icon)
    expect(projectSection('inbox')?.icon.displayName).toBe('Bell')
  })
})

describe('under Persönlich (ADR-0193)', () => {
  it('carries its own places: the personal chat, Meine Ablage, the Postfach and "Mehr", in that order', () => {
    const tabs = personalPhoneTabs('/app/personal/chat', ALL)
    expect(keys(tabs)).toEqual(['chat', 'personalShelf', 'inbox', 'more'])
    expect(tabs.find((tab) => tab.key === 'chat')).toMatchObject({ href: '/app/personal/chat' })
    expect(tabs.find((tab) => tab.key === 'personalShelf')).toMatchObject({
      href: '/app/personal-shelf',
      label: { namespace: 'nav', key: 'personalShelf' },
    })
  })

  it('lights the place the reader is in, and "Mehr" elsewhere', () => {
    expect(lit(personalPhoneTabs('/app/personal/chat', ALL))).toEqual(['chat'])
    expect(lit(personalPhoneTabs('/app/personal-shelf', ALL))).toEqual(['personalShelf'])
    expect(lit(personalPhoneTabs('/app/personal/memory', ALL))).toEqual(['more'])
  })

  it('drops the Postfach for a reader without one, and keeps "Mehr" last', () => {
    expect(keys(personalPhoneTabs('/app/personal/chat', NONE))).toEqual(['chat', 'personalShelf', 'more'])
  })

  it('never carries a project’s places', () => {
    expect(keys(personalPhoneTabs('/app/personal-shelf', ALL))).not.toContain('files')
    expect(keys(personalPhoneTabs('/app/personal-shelf', ALL))).not.toContain('settings')
  })
})

describe('every label of the project bar fits its tab on a 360px phone', () => {
  // A fifth of 360px less the bar's 8px and the label's 4px. Widths measured in Chromium at 12px semibold (the open tab),
  // 2026-11-24: "Documents" at 66.5px was cut by a tenth of a pixel. A new label is measured before it is added here.
  const ROOM_PX = (360 - 8) / 5 - 4
  const MEASURED_PX: Record<string, number> = {
    Chat: 28.2, Ablage: 40.3, Projekt: 42, Postfach: 51.8, Mehr: 30.2,
    Files: 26.7, Project: 41.8, Inbox: 31.9, More: 30.1, Documents: 66.5,
  }

  for (const locale of ['de', 'en'] as const) {
    it(locale, () => {
      for (const tab of projectPhoneTabs('p1', '/app/projects/p1/chat', ALL)) {
        const copy = tab.label.namespace === 'nav' ? navCopy : collaborationCopy
        const text = tab.label.key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], copy.messages[locale])
        expect(typeof text, `${tab.key} in ${locale}`).toBe('string')
        const width = MEASURED_PX[text as string]
        expect(width, `„${String(text)}“ has not been measured`).toBeDefined()
        expect(width, `„${String(text)}“`).toBeLessThanOrEqual(ROOM_PX)
      }
    })
  }
})
