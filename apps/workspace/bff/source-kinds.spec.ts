/**
 * @vitest-environment node
 */
import { describe, test, expect } from 'vitest'
import { chatCopy } from '@/i18n/namespaces/chat'
import {
  AGENT_AUTHORED_LANE,
  AGENT_AUTHORED_LANE_LABEL,
  MAIL_LANE,
  MAIL_LANE_LABEL,
  OFFICE_MAIL_LANE,
  KIND_TO_SIGNAL,
  CITATION_KEY_QUALIFIERS,
  SHELVES,
  accentForLane,
  asShelf,
  asSourceKind,
  authorityTag,
  kindForLane,
  modernizeLane,
  scopeForQualifier,
  type Shelf,
  type SourceKind,
} from './source-kinds'
import { PRODUCT_NAME } from '@/lib/brand'

describe('asSourceKind', () => {
  test('accepts the four canonical kinds', () => {
    for (const k of ['building_law', 'office', 'project', 'web'] as SourceKind[]) {
      expect(asSourceKind(k)).toBe(k)
    }
  })

  test('rejects unknown / empty values', () => {
    expect(asSourceKind('law')).toBeUndefined()
    expect(asSourceKind('')).toBeUndefined()
    expect(asSourceKind(null)).toBeUndefined()
    expect(asSourceKind(undefined)).toBeUndefined()
  })
})

describe('KIND_TO_SIGNAL', () => {
  test('maps the OIB corpus + RIS (building_law) to the law tint family', () => {
    expect(KIND_TO_SIGNAL.building_law).toBe('law')
  })

  test('maps office/project/web to their families', () => {
    expect(KIND_TO_SIGNAL.office).toBe('office')
    expect(KIND_TO_SIGNAL.project).toBe('project')
    expect(KIND_TO_SIGNAL.web).toBe('auto')
  })
})

describe('the German spellings a stored lane still carries', () => {
  test('a German kind is no kind: migration 0163 rewrote every stored one', () => {
    expect(asSourceKind('baurecht')).toBeUndefined()
  })

  test('a lane reads as its English key, and still means the same kind and tag', () => {
    expect(modernizeLane('baurecht_oib_leitfaden')).toBe('building_law_oib_guide')
    expect(modernizeLane('buero_piloti')).toBe('office_piloti')
    expect(modernizeLane('norm_extern')).toBe('external_standard')
    expect(kindForLane('baurecht_land')).toBe('building_law')
    expect(kindForLane('behoerde')).toBe('building_law')
    expect(authorityTag('norm_extern')).toBe('ÖNORM')
    expect(authorityTag('baurecht_oib')).toBe('OIB')
    expect(modernizeLane('building_law_oib')).toBe('building_law_oib')
  })
})

describe('authorityTag', () => {
  test('distinguishes OIB from RIS within the Baurecht family', () => {
    expect(authorityTag('building_law_oib')).toBe('OIB')
    expect(authorityTag('building_law_oib_guide')).toBe('OIB')
    expect(authorityTag('building_law_ris')).toBe('RIS')
    expect(authorityTag('building_law_federal')).toBe('RIS')
    expect(authorityTag('building_law_ordinance')).toBe('RIS')
  })

  test('tags external norms and authority info distinctly', () => {
    expect(authorityTag('external_standard')).toBe('ÖNORM')
    expect(authorityTag('authority')).toBe('Behörde')
  })

  test('office/project/web carry no authority tag', () => {
    expect(authorityTag('office')).toBeNull()
    expect(authorityTag('project')).toBeNull()
    expect(authorityTag('web')).toBeNull()
    expect(authorityTag(null)).toBeNull()
  })

  test('an unclassified document does not claim to be an Austrian legal source', () => {
    expect(authorityTag('building_law_base')).toBeNull()
  })
})

describe('the agent-authored lane', () => {
  test('is a sub-label inside the office kind, never a kind of its own', () => {
    expect(AGENT_AUTHORED_LANE).toBe('office_piloti')
    expect(kindForLane(AGENT_AUTHORED_LANE)).toBe('office')
    expect(asSourceKind(AGENT_AUTHORED_LANE)).toBeUndefined()
  })

  test('its label names the document kind and no approver', () => {
    expect(AGENT_AUTHORED_LANE_LABEL).toBe(`${PRODUCT_NAME}-Dokument`)
    expect(AGENT_AUTHORED_LANE_LABEL).not.toContain('{')
  })

  test('carries no authority tag — it is not a rung of the legal ladder', () => {
    expect(authorityTag(AGENT_AUTHORED_LANE)).toBeNull()
  })
})

describe('the mail lanes', () => {
  test("are sub-labels inside the shelf's kind, never a kind of their own", () => {
    expect(MAIL_LANE).toBe('project_mail')
    expect(OFFICE_MAIL_LANE).toBe('office_mail')
    expect(kindForLane(MAIL_LANE)).toBe('project')
    expect(kindForLane(OFFICE_MAIL_LANE)).toBe('office')
    expect(asSourceKind(MAIL_LANE)).toBeUndefined()
    expect(MAIL_LANE_LABEL).toBe('E-Mail')
  })

  test('carry no authority tag, whoever sent the mail', () => {
    expect(authorityTag(MAIL_LANE)).toBeNull()
    expect(authorityTag(OFFICE_MAIL_LANE)).toBeNull()
    expect(accentForLane(MAIL_LANE, 'project')).toBe('project')
  })
})

describe('Shelf (ADR-0047)', () => {
  test('is exactly the four wire shelves', () => {
    expect([...SHELVES]).toEqual(['office_shelf', 'project', 'session', 'base'])
  })

  test('accepts a shelf the wire states, case- and whitespace-tolerantly', () => {
    for (const shelf of SHELVES) expect(asShelf(shelf)).toBe(shelf)
    expect(asShelf(' Session ')).toBe('session')
  })

  test('an unknown or missing shelf is UNKNOWN — never a default', () => {
    expect(asShelf('building_law')).toBeUndefined()
    expect(asShelf('projekt')).toBeUndefined()
    expect(asShelf('archiv_org1')).toBeUndefined()
    expect(asShelf('archiv')).toBeUndefined()
    expect(asShelf('')).toBeUndefined()
    expect(asShelf(null)).toBeUndefined()
    expect(asShelf(undefined)).toBeUndefined()
  })
})

describe('the shelf labels in the dictionary', () => {
  test('every shelf has a distinct label, in both languages', () => {
    for (const dictionary of [chatCopy.messages.de.sourceTabs.shelves, chatCopy.messages.en.sourceTabs.shelves]) {
      const labels = SHELVES.map((shelf: Shelf) => dictionary[shelf])
      expect(labels.every((label) => typeof label === 'string' && label.length > 0)).toBe(true)
      expect(new Set(labels).size).toBe(SHELVES.length)
    }
  })

  test('a private session attachment is NOT labelled as project knowledge', () => {
    expect(chatCopy.messages.de.sourceTabs.shelves.session).toBe('Private Sitzung')
    expect(chatCopy.messages.de.sourceTabs.shelves.session).not.toBe(chatCopy.messages.de.sourceTabs.shelves.project)
  })
})

describe('scopeForQualifier (citation keys — the versioned fallback)', () => {
  test('every qualifier a writer can emit parses back to its shelf', () => {
    for (const [qualifier, shelf] of CITATION_KEY_QUALIFIERS) {
      expect(scopeForQualifier(qualifier)).toBe(shelf)
    }
    expect(CITATION_KEY_QUALIFIERS.map(([, shelf]) => shelf)).toEqual([
      'office_shelf',
      'project',
      'base',
      'session',
      'office_shelf',
    ])
  })

  test('the archiv shelf is written „Büroablage" and still read under its old name', () => {
    expect(CITATION_KEY_QUALIFIERS[0]).toEqual(['Büroablage', 'office_shelf'])
    expect(scopeForQualifier('Büroablage')).toBe('office_shelf')
    expect(scopeForQualifier('Büroarchiv')).toBe('office_shelf')
  })

  test('the shelf label the reader sees is the qualifier the backend writes', () => {
    expect(chatCopy.messages.de.sourceTabs.shelves.office_shelf).toBe(CITATION_KEY_QUALIFIERS[0][0])
    expect(chatCopy.messages.en.sourceTabs.shelves.office_shelf).toBe('Office filing')
  })

  test('every shelf is reachable from a key, so no key can go unread', () => {
    const qualified = new Set(CITATION_KEY_QUALIFIERS.map(([, shelf]) => shelf))
    for (const shelf of SHELVES) expect(qualified.has(shelf)).toBe(true)
  })

  test('qualifiers are matched case-insensitively', () => {
    expect(scopeForQualifier('projektwissen')).toBe('project')
    expect(scopeForQualifier('  BÜROARCHIV  ')).toBe('office_shelf')
    expect(scopeForQualifier('private sitzung')).toBe('session')
    expect(scopeForQualifier('Internal')).toBeUndefined()
    expect(scopeForQualifier('')).toBeUndefined()
    expect(scopeForQualifier(null)).toBeUndefined()
  })
})
