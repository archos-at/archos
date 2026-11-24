/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  orgPhoneTabs,
  personalPhoneTabs,
  phoneBackTarget,
  phoneTabBarHiddenOnRoute,
  projectPhoneTabs,
  type PhoneTabLabel,
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

  it('links where the rail links: a fresh chat, the files, the overview, the org Postfach', () => {
    const hrefs = Object.fromEntries(
      projectPhoneTabs('p1', '/app/projects/p1/files', ALL).map((tab) => [tab.key, tab.href])
    )
    expect(hrefs).toEqual({
      chat: '/app/projects/p1/chat?new=1',
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

  it('names each tab with the rail label (the settings tab with its short one), and marks it as a tour stop', () => {
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
      label: { namespace: 'nav', key: 'sections.files' },
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

describe('above a project', () => {
  it('carries Projekte, the Bürobibliothek and the Postfach, and no "Mehr"', () => {
    expect(keys(orgPhoneTabs('/app/projects', ALL))).toEqual(['projects', 'officeShelf', 'inbox'])
  })

  it('carries only what the organization has', () => {
    expect(keys(orgPhoneTabs('/app/projects', NONE))).toEqual(['projects'])
  })

  it('lights Projekte on the projects home, a doorway while its sheet stands, and nothing on an account page', () => {
    expect(lit(orgPhoneTabs('/app/projects', ALL))).toEqual(['projects'])
    expect(lit(orgPhoneTabs('/app/office-shelf', ALL))).toEqual(['officeShelf'])
    expect(lit(orgPhoneTabs('/app/profile', ALL))).toEqual([])
    expect(lit(orgPhoneTabs('/app/organization/access', ALL))).toEqual([])
  })

  it('points the welcome tour at its doorways', () => {
    const [, officeShelf, inbox] = orgPhoneTabs('/app/projects', ALL)
    expect(officeShelf?.tourAnchor).toBe('office-shelf')
    expect(inbox?.tourAnchor).toBe('inbox')
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
    const inboxTab = orgPhoneTabs('/app/projects', ALL).find((tab) => tab.key === 'inbox')
    const officeShelfTab = orgPhoneTabs('/app/projects', ALL).find((tab) => tab.key === 'officeShelf')
    expect(inboxTab?.icon).toBe(projectSection('inbox')?.icon)
    expect(inboxTab?.icon).not.toBe(officeShelfTab?.icon)
    expect(projectSection('inbox')?.icon).not.toBe(projectSection('officeShelf')?.icon)
    expect(projectSection('inbox')?.icon.displayName).toBe('Bell')
  })
})

describe('under Persönlich (ADR-0193)', () => {
  it('carries its own places: a new personal chat, Meine Ablage, the Postfach and "Mehr", in that order', () => {
    const tabs = personalPhoneTabs('/app/personal/chat', ALL)
    expect(keys(tabs)).toEqual(['chat', 'personalShelf', 'inbox', 'more'])
    expect(tabs.find((tab) => tab.key === 'chat')).toMatchObject({ href: '/app/personal/chat?new=1' })
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

describe('every tab label fits its tab on a 360px phone', () => {
  const PHONE_WIDTH = 360
  const BAR_PADDING = 8
  const LABEL_PADDING = 4
  // The bar's labels are 11px below 380px; „Dokumente“ in the active tab's semibold measured 65px there in Chromium,
  // „Meine Ablage“ 75.5px: a space is about half a glyph.
  const GLYPH_AT_11PX_SEMIBOLD = 65 / 9

  const resolve = (locale: 'de' | 'en', label: PhoneTabLabel): string => {
    const copy = label.namespace === 'nav' ? navCopy : collaborationCopy
    const value = label.key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], copy.messages[locale])
    if (typeof value !== 'string') throw new Error(`no label at ${label.namespace}.${label.key}`)
    return value
  }

  const bars = {
    project: projectPhoneTabs('p1', '/app/projects/p1/chat', ALL),
    personal: personalPhoneTabs('/app/personal/chat', ALL),
    org: orgPhoneTabs('/app/projects', ALL),
  }

  for (const locale of ['de', 'en'] as const) {
    for (const [scope, tabs] of Object.entries(bars)) {
      it(`${locale}, ${scope} bar`, () => {
        const room = (PHONE_WIDTH - BAR_PADDING) / tabs.length - LABEL_PADDING
        for (const tab of tabs) {
          const text = resolve(locale, tab.label)
          const glyphs = text.length - text.split(' ').length / 2 + 0.5
          expect(glyphs * GLYPH_AT_11PX_SEMIBOLD, `${tab.key} in ${locale}: „${text}“`).toBeLessThanOrEqual(room)
        }
      })
    }
  }
})
