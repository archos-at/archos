import { describe, expect, it } from 'vitest'
import { onboarding as de } from '@/i18n/dictionaries/de/onboarding'
import { onboarding as en } from '@/i18n/dictionaries/en/onboarding'
import {
  ARRIVAL_ANCHOR,
  NO_TOURS,
  TOURS,
  TOUR_HOME,
  TOUR_SEEN_KEYS,
  TOUR_START_URL,
  TOUR_ANCHORS,
  cardShift,
  cardShiftY,
  cardSide,
  isSetupPage,
  placeStops,
  projectTourUrl,
  requestedTour,
  sectionAnchor,
  tourAnchorSelector,
  tourEligibility,
  tourForPath,
  withoutTourRequest,
  type AnchorBox,
  type TourReader,
} from './product-tour'

const DESKTOP = { width: 1280, height: 820 }
const PHONE = { width: 390, height: 844 }
const ALL_ON: TourReader = { canAccessOfficeShelf: true, canAccessInbox: true, canManageOrganization: true, handover: true }
const BOX: AnchorBox = { left: 900, right: 1000, top: 20, bottom: 56 }
const everywhere = (): AnchorBox => BOX
const nowhere = (): AnchorBox | null => null

const ids = (stops: { id: string }[]): string[] => stops.map((stop) => stop.id)

const READERS: Record<string, TourReader> = {
  admin: ALL_ON,
  joiner: { ...ALL_ON, handover: false },
  member: { ...ALL_ON, handover: false, canManageOrganization: false },
  bare: { canAccessOfficeShelf: false, canAccessInbox: false, canManageOrganization: false, handover: false },
}

describe('welcome tour', () => {
  it('opens on a centred card, then the two sides, the projects, the office’s doorways and the person', () => {
    expect(ids(placeStops(TOURS.welcome, ALL_ON, everywhere, DESKTOP))).toEqual([
      'welcome',
      'sides',
      'projects',
      'officeShelf',
      'inbox',
      'search',
      'account',
    ])
  })

  it('drops the Bürobibliothek and the Postfach for a reader without them', () => {
    const reader = { ...ALL_ON, canAccessOfficeShelf: false, canAccessInbox: false }
    expect(ids(placeStops(TOURS.welcome, reader, everywhere, DESKTOP))).toEqual([
      'welcome',
      'sides',
      'projects',
      'search',
      'account',
    ])
  })

  it('lives on the personal chat, where a new person lands, never over the project overview window', () => {
    expect(TOUR_HOME).toBe('/app/personal/chat')
    expect(new URL(TOUR_START_URL, 'http://x').pathname).toBe(TOUR_HOME)
    expect(tourForPath('/app/projects')).toBeNull()
    expect(ARRIVAL_ANCHOR.welcome).toEqual([TOUR_ANCHORS.sides, TOUR_ANCHORS.menu])
  })
})

describe('project tour', () => {
  it('walks chat, Ablage, Ablage against Bürobibliothek, sources and settings', () => {
    expect(ids(placeStops(TOURS.project, ALL_ON, everywhere, DESKTOP))).toEqual([
      'projectWelcome',
      'projectChat',
      'projectFiles',
      'filesOrOfficeShelf',
      'projectSources',
      'projectSettings',
    ])
  })

  it('points at the rail items the sidebar marks, by section key, and at the project switcher for settings', () => {
    const anchors = TOURS.project.flatMap((stop) => (stop.anchor ? [stop.anchor] : []))
    expect(anchors).toEqual([...['chat', 'files', 'officeShelf'].map(sectionAnchor), TOUR_ANCHORS.projectSwitcher])
  })

  it('drops the Bürobibliothek stop when the reader has no Bürobibliothek', () => {
    const placed = placeStops(TOURS.project, { ...ALL_ON, canAccessOfficeShelf: false }, everywhere, DESKTOP)
    expect(ids(placed)).not.toContain('filesOrOfficeShelf')
  })

  it('on a phone, points at the menu at the top left: the chat and the settings live in it, the rest is told in the middle', () => {
    const menu: Record<string, AnchorBox> = {
      [tourAnchorSelector(TOUR_ANCHORS.menu)]: { left: 12, right: 56, top: 10, bottom: 54 },
    }
    const placed = placeStops(TOURS.project, { ...ALL_ON, phone: true }, (selector) => menu[selector] ?? null, PHONE)
    expect(ids(placed)).toEqual([
      'projectWelcome',
      'projectChatPhone',
      'projectFiles',
      'filesOrOfficeShelfPhone',
      'projectSources',
      'projectSettingsPhone',
    ])
    expect(placed.find((stop) => stop.id === 'projectChatPhone')).toMatchObject({ anchor: TOUR_ANCHORS.menu, side: 'bottom-left' })
    expect(placed.find((stop) => stop.id === 'filesOrOfficeShelfPhone')?.anchor).toBeUndefined()
  })

  it('waits for nothing on arrival — the rail is shell chrome, already standing', () => {
    expect(ARRIVAL_ANCHOR.project).toEqual([])
  })
})

describe('a stop whose anchor is not on the screen', () => {
  it('is skipped, never shown pointing at nothing; the centred stops stay', () => {
    expect(ids(placeStops(TOURS.project, ALL_ON, nowhere, DESKTOP))).toEqual(['projectWelcome', 'projectSources'])
    expect(ids(placeStops(TOURS.welcome, ALL_ON, nowhere, DESKTOP))).toEqual(['welcome'])
  })

  it('is skipped on the folded icon rail, which has no wordmark and no magnifier', () => {
    const folded = (selector: string): AnchorBox | null =>
      selector === tourAnchorSelector(TOUR_ANCHORS.projects) || selector === tourAnchorSelector(TOUR_ANCHORS.search) ? null : BOX
    expect(ids(placeStops(TOURS.welcome, ALL_ON, folded, DESKTOP))).toEqual(['welcome', 'sides', 'officeShelf', 'inbox', 'account'])
  })
})

describe('the welcome tour on a phone', () => {
  const anchors: Record<string, AnchorBox> = {
    [tourAnchorSelector(TOUR_ANCHORS.menu)]: { left: 12, right: 56, top: 10, bottom: 54 },
  }
  const locate = (selector: string): AnchorBox | null => anchors[selector] ?? null

  it('is two stops: the welcome, then the menu that holds everything else', () => {
    const placed = placeStops(TOURS.welcome, { ...ALL_ON, phone: true }, locate, PHONE)
    expect(ids(placed)).toEqual(['welcome', 'menuPhone'])
    expect(placed.find((stop) => stop.id === 'menuPhone')).toMatchObject({ anchor: TOUR_ANCHORS.menu, side: 'bottom-left' })
  })

  it('does not name a Bürobibliothek in the menu to a reader who has none', () => {
    const placed = placeStops(TOURS.welcome, { ...ALL_ON, canAccessOfficeShelf: false, phone: true }, locate, PHONE)
    expect(ids(placed)).toContain('menuPhoneShelfless')
  })
})

describe('the welcome tour on a desktop', () => {
  it('opens a card beside each rail doorway, kept on screen at the rail’s top and its foot', () => {
    const anchors: Record<string, AnchorBox> = {
      [tourAnchorSelector(TOUR_ANCHORS.sides)]: { left: 12, right: 260, top: 58, bottom: 90 },
      [tourAnchorSelector(TOUR_ANCHORS.projects)]: { left: 24, right: 88, top: 18, bottom: 38 },
      [tourAnchorSelector(TOUR_ANCHORS.search)]: { left: 196, right: 222, top: 15, bottom: 41 },
      [tourAnchorSelector(TOUR_ANCHORS.sectionOfficeShelf)]: { left: 12, right: 260, top: 716, bottom: 752 },
      [tourAnchorSelector(TOUR_ANCHORS.inbox)]: { left: 198, right: 226, top: 776, bottom: 804 },
      [tourAnchorSelector(TOUR_ANCHORS.account)]: { left: 12, right: 190, top: 776, bottom: 804 },
    }
    const placed = placeStops(TOURS.welcome, ALL_ON, (selector) => anchors[selector] ?? null, DESKTOP)
    for (const id of ['sides', 'projects', 'search', 'officeShelf', 'inbox', 'account']) {
      const stop = placed.find((each) => each.id === id)!
      expect(stop.side).toBe('right')
      const height = 240
      const top = stop.middleY! - height / 2 + cardShiftY(stop.middleY!, height, DESKTOP.height)
      expect(top).toBeGreaterThanOrEqual(16)
      expect(top + height).toBeLessThanOrEqual(DESKTOP.height - 16)
    }
  })
})

describe('the copy', () => {
  const variants = (tour: keyof typeof TOURS): string[] =>
    Object.values(READERS).flatMap((reader) =>
      [false, true].flatMap((phone) => ids(placeStops(TOURS[tour], { ...reader, phone }, everywhere, phone ? PHONE : DESKTOP))),
    )

  it('has a title and a body in German and English for every stop any reader can reach', () => {
    for (const id of new Set([...variants('welcome'), ...variants('project')])) {
      for (const dictionary of [de, en]) {
        const stop = (dictionary.tour.stops as Record<string, { title?: string; body?: string }>)[id]
        expect(stop?.title, id).toBeTruthy()
        expect(stop?.body, id).toBeTruthy()
      }
    }
  })

  it('names no place the shell no longer has', () => {
    const text = JSON.stringify(de.tour.stops)
    for (const gone of ['Organisation erstellt', 'Seitenleiste', '„Mehr“', 'Tab „', 'Dateien', 'Büroablage', 'Archiv']) {
      expect(text).not.toContain(gone)
    }
  })
})

describe('cardSide', () => {
  it('below an anchor in the right half, hangs the card leftwards', () => {
    expect(cardSide({ left: 1040, right: 1184, top: 96, bottom: 132 }, DESKTOP, 'below')).toBe('bottom-right')
  })

  it('below an anchor in the left half — the phone’s side switch — hangs it rightwards', () => {
    expect(cardSide({ left: 16, right: 224, top: 8, bottom: 52 }, PHONE, 'below')).toBe('bottom-left')
  })

  it('the element overrides the stop: a tab says "above" even for a stop written for the rail', () => {
    expect(cardSide({ left: 81, right: 158, top: 760, bottom: 812, placement: 'above' }, PHONE, 'beside')).toBe('top')
  })

  it('beside a rail item, centres on it wherever it is — `right-top` / `right-bottom` flip the wrong way in nextstepjs', () => {
    expect(cardSide({ left: 12, right: 224, top: 150, bottom: 186 }, DESKTOP, 'beside')).toBe('right')
    expect(cardSide({ left: 12, right: 224, top: 776, bottom: 804 }, DESKTOP, 'beside')).toBe('right')
  })
})

describe('cardShiftY', () => {
  it('leaves a card that fits where NextStep centred it', () => {
    expect(cardShiftY(400, 200, DESKTOP.height)).toBe(0)
  })

  it('moves a card beside the switch down below the top gutter, and one beside the bell up above the foot', () => {
    expect(cardShiftY(74, 240, DESKTOP.height)).toBe(62)
    expect(cardShiftY(790, 240, DESKTOP.height)).toBe(-106)
  })
})

describe('cardShift', () => {
  it('leaves a card that fits where NextStep centred it', () => {
    expect(cardShift({ left: 158, right: 235, top: 760, bottom: 812 }, PHONE)).toBe(0)
  })

  it('slides a card over the second tab back inside the left gutter, and one over the last tab inside the right', () => {
    expect(cardShift({ left: 81, right: 158, top: 760, bottom: 812 }, PHONE)).toBe(72.5)
    expect(cardShift({ left: 312, right: 389, top: 760, bottom: 812 }, PHONE)).toBe(-152.5)
  })
})

describe('where tours run and how they are asked for', () => {
  it('maps the personal chat to the welcome tour and any project page to the project tour', () => {
    expect(tourForPath('/app/personal/chat')).toBe('welcome')
    expect(tourForPath('/app/personal/chat/c1')).toBe('welcome')
    expect(tourForPath('/app/projects/p1')).toBe('project')
    expect(tourForPath('/app/projects/p1/files')).toBe('project')
    expect(tourForPath('/app/organization')).toBeNull()
    expect(tourForPath('/app/personal/shelf')).toBeNull()
  })

  it('reads the tour from the hand-over URLs, and nothing else', () => {
    expect(requestedTour(new URL(TOUR_START_URL, 'http://x').search)).toBe('welcome')
    expect(requestedTour(new URL(projectTourUrl('p1'), 'http://x').search)).toBe('project')
    expect(requestedTour('?tour=other')).toBeNull()
    expect(requestedTour('?new=1')).toBeNull()
  })

  it('sends the project hand-over straight to chat, where the tour belongs', () => {
    expect(new URL(projectTourUrl('p1'), 'http://x').pathname).toBe('/app/projects/p1/chat')
    expect(tourForPath('/app/projects/p1/chat')).toBe('project')
  })

  it('builds anchor selectors the DOM can match', () => {
    expect(tourAnchorSelector('section-files')).toBe('[data-tour="section-files"]')
  })
})

describe('the joiner', () => {
  const joiner = READERS.joiner!

  it('is told projects arrive as colleagues add them', () => {
    expect(ids(placeStops(TOURS.welcome, joiner, everywhere, DESKTOP))).toContain('projectsJoined')
  })

  it('is welcomed to the organization, not told it is ready', () => {
    expect(ids(placeStops(TOURS.welcome, joiner, everywhere, DESKTOP))[0]).toBe('welcomeJoined')
    expect(ids(placeStops(TOURS.welcome, ALL_ON, everywhere, DESKTOP))[0]).toBe('welcome')
  })

  it('is welcomed to the project, not told they set it up', () => {
    expect(ids(placeStops(TOURS.project, joiner, everywhere, DESKTOP))[0]).toBe('projectWelcomeJoined')
    expect(ids(placeStops(TOURS.project, ALL_ON, everywhere, DESKTOP))[0]).toBe('projectWelcome')
  })

  it('is not promised organization management they do not hold', () => {
    expect(ids(placeStops(TOURS.welcome, READERS.member!, everywhere, DESKTOP))).toContain('accountMember')
    expect(ids(placeStops(TOURS.welcome, joiner, everywhere, DESKTOP))).toContain('account')
  })

  it('keeps the spotlight on a variant stop — only the words change', () => {
    const account = placeStops(TOURS.welcome, READERS.member!, everywhere, DESKTOP).find((stop) => stop.id === 'accountMember')
    expect(account?.anchor).toBe('account-menu')
    expect(account?.side).toBeDefined()
  })
})

describe('tourEligibility — which tours start by themselves', () => {
  it('starts both for someone new here who has seen neither', () => {
    expect(tourEligibility({}, false)).toEqual({ welcome: true, project: true })
  })

  it('starts only the one not yet seen', () => {
    const prefs = { [TOUR_SEEN_KEYS.welcome]: '2026-09-23T10:00:00.000Z' }
    expect(tourEligibility(prefs, false)).toEqual({ welcome: false, project: true })
  })

  it('starts nothing for someone who has already written here — every member before this shipped', () => {
    expect(tourEligibility({}, true)).toEqual(NO_TOURS)
  })
})

describe('isSetupPage', () => {
  it('marks the intake wizard, which no tour interrupts — its first save hands over by itself', () => {
    expect(isSetupPage('/app/projects/p1/intake')).toBe(true)
    expect(isSetupPage('/app/projects/p1/chat')).toBe(false)
    expect(isSetupPage('/app/personal/chat')).toBe(false)
  })
})

describe('withoutTourRequest', () => {
  it('takes the tour request out and keeps everything else', () => {
    expect(withoutTourRequest('/app/personal/chat', '?tour=welcome')).toBe('/app/personal/chat')
    expect(withoutTourRequest('/dev/product-tour', '?variant=project&tour=project')).toBe(
      '/dev/product-tour?variant=project',
    )
  })
})
