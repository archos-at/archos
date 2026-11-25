export type TourId = 'welcome' | 'project'

export const TOUR_QUERY_PARAM = 'tour'

export const TOUR_HOME = '/app/personal/chat'

export function tourStartUrl(path: string, tour: TourId): string {
  return `${path}?${TOUR_QUERY_PARAM}=${tour}`
}

export const TOUR_START_URL = tourStartUrl(TOUR_HOME, 'welcome')

export function projectTourUrl(projectId: string): string {
  return tourStartUrl(`/app/projects/${projectId}/chat`, 'project')
}

export const TOUR_ANCHORS = {
  sides: 'side-switch',
  sidesPhone: 'side-switch-phone',
  projects: 'projects',
  projectSwitcher: 'project-switcher',
  inbox: 'inbox',
  account: 'account-menu',
  sectionChat: 'section-chat',
  sectionFiles: 'section-files',
  sectionOfficeShelf: 'section-officeShelf',
  sectionSettings: 'section-settings',
  more: 'tab-more',
  search: 'search',
} as const

export type TourAnchor = (typeof TOUR_ANCHORS)[keyof typeof TOUR_ANCHORS]

export function sectionAnchor(sectionKey: string): string {
  return `section-${sectionKey}`
}

export type TourPlacement = 'below' | 'beside' | 'above'

export type TourSide = 'bottom-left' | 'bottom-right' | 'right' | 'top'

export const TOUR_PLACEMENT_ATTRIBUTE = 'data-tour-placement'

export interface TourFlags {
  canAccessOfficeShelf: boolean
  canAccessInbox: boolean
  canManageOrganization: boolean
}

export interface TourReader extends TourFlags {
  handover: boolean
  phone?: boolean
}

export interface TourStop {
  id: string
  anchor?: TourAnchor
  placement?: TourPlacement
  gate?: 'canAccessOfficeShelf' | 'canAccessInbox'
  arrivalId?: string
  memberId?: string
  shelflessId?: string
  phone?: { id: string; anchor?: TourAnchor; placement?: TourPlacement; memberId?: string; shelflessId?: string } | null
}

export interface PlacedTourStop extends TourStop {
  side?: TourSide
  shiftX?: number
  middleY?: number
}

const WELCOME_STOPS: readonly TourStop[] = [
  { id: 'welcome', arrivalId: 'welcomeJoined' },
  {
    id: 'sides',
    anchor: TOUR_ANCHORS.sides,
    placement: 'beside',
    phone: { id: 'sidesPhone', anchor: TOUR_ANCHORS.sidesPhone, placement: 'below' },
  },
  {
    id: 'projects',
    anchor: TOUR_ANCHORS.projects,
    placement: 'beside',
    arrivalId: 'projectsJoined',
    phone: { id: 'morePhone', anchor: TOUR_ANCHORS.more, shelflessId: 'morePhoneShelfless' },
  },
  { id: 'officeShelf', anchor: TOUR_ANCHORS.sectionOfficeShelf, placement: 'beside', gate: 'canAccessOfficeShelf', phone: null },
  { id: 'inbox', anchor: TOUR_ANCHORS.inbox, placement: 'beside', gate: 'canAccessInbox' },
  { id: 'search', anchor: TOUR_ANCHORS.search, placement: 'beside', phone: null },
  { id: 'account', anchor: TOUR_ANCHORS.account, placement: 'beside', memberId: 'accountMember', phone: null },
]

const PROJECT_STOPS: readonly TourStop[] = [
  { id: 'projectWelcome', arrivalId: 'projectWelcomeJoined' },
  {
    id: 'projectChat',
    anchor: TOUR_ANCHORS.sectionChat,
    placement: 'beside',
    phone: { id: 'projectChatPhone', anchor: TOUR_ANCHORS.sectionChat },
  },
  { id: 'projectFiles', anchor: TOUR_ANCHORS.sectionFiles, placement: 'beside' },
  {
    id: 'filesOrOfficeShelf',
    anchor: TOUR_ANCHORS.sectionOfficeShelf,
    placement: 'beside',
    gate: 'canAccessOfficeShelf',
    phone: { id: 'filesOrOfficeShelfPhone', anchor: TOUR_ANCHORS.more },
  },
  { id: 'projectSources' },
  {
    id: 'projectSettings',
    anchor: TOUR_ANCHORS.projectSwitcher,
    placement: 'beside',
    phone: { id: 'projectSettingsPhone', anchor: TOUR_ANCHORS.sectionSettings },
  },
]

export const TOURS: Record<TourId, readonly TourStop[]> = {
  welcome: WELCOME_STOPS,
  project: PROJECT_STOPS,
}

export const ARRIVAL_ANCHOR: Record<TourId, readonly TourAnchor[]> = {
  welcome: [TOUR_ANCHORS.sides, TOUR_ANCHORS.sidesPhone],
  project: [],
}

export function tourForPath(pathname: string): TourId | null {
  if (pathname === TOUR_HOME || pathname.startsWith(`${TOUR_HOME}/`)) return 'welcome'
  if (/^\/app\/projects\/[^/]+(\/|$)/.test(pathname)) return 'project'
  return null
}

export function isSetupPage(pathname: string): boolean {
  return /^\/app\/projects\/[^/]+\/intake(\/|$)/.test(pathname)
}

export const TOUR_SEEN_KEYS = {
  welcome: 'tourWelcomeSeenAt',
  project: 'tourProjectSeenAt',
} as const satisfies Record<TourId, string>

export type TourEligibility = Record<TourId, boolean>

export const NO_TOURS: TourEligibility = { welcome: false, project: false }

export function tourEligibility(prefs: Record<string, unknown>, hasWritten: boolean): TourEligibility {
  if (hasWritten) return NO_TOURS
  return {
    welcome: !prefs[TOUR_SEEN_KEYS.welcome],
    project: !prefs[TOUR_SEEN_KEYS.project],
  }
}

export function tourAnchorSelector(anchor: TourAnchor): string {
  return `[data-tour="${anchor}"]`
}

export interface AnchorBox {
  left: number
  right: number
  top: number
  bottom: number
  placement?: TourPlacement
}

export interface Viewport {
  width: number
  height: number
}

export function cardSide(box: AnchorBox, viewport: Viewport, placement: TourPlacement): TourSide {
  const resolved = box.placement ?? placement
  if (resolved === 'above') return 'top'
  if (resolved === 'beside') return 'right'
  return box.left + box.right > viewport.width ? 'bottom-right' : 'bottom-left'
}

const CARD_MAX_WIDTH_PX = 352
const CARD_GUTTER_PX = 16

export function cardShift(box: AnchorBox, viewport: Viewport): number {
  const width = Math.min(CARD_MAX_WIDTH_PX, viewport.width - 2 * CARD_GUTTER_PX)
  const left = (box.left + box.right) / 2 - width / 2
  const min = CARD_GUTTER_PX
  const max = viewport.width - CARD_GUTTER_PX - width
  const clamped = Math.min(Math.max(left, min), Math.max(min, max))
  return clamped - left
}

// nextstepjs 2.3.0 flips `right-top` / `right-bottom` the wrong way near an edge, so a centred
// `right` card is moved back on screen by this much once its height is known.
export function cardShiftY(middleY: number, cardHeight: number, viewportHeight: number): number {
  const top = middleY - cardHeight / 2
  const max = viewportHeight - CARD_GUTTER_PX - cardHeight
  const clamped = Math.max(CARD_GUTTER_PX, Math.min(top, max))
  return clamped - top
}

export function placeStops(
  stops: readonly TourStop[],
  reader: TourReader,
  locate: (selector: string) => AnchorBox | null,
  viewport: Viewport,
): PlacedTourStop[] {
  return stops.flatMap((given): PlacedTourStop[] => {
    if (given.gate && !reader[given.gate]) return []
    if (reader.phone && given.phone === null) return []
    const stop: TourStop =
      reader.phone && given.phone
        ? {
            ...given,
            ...given.phone,
            arrivalId: undefined,
            memberId: given.phone.memberId,
            shelflessId: given.phone.shelflessId,
            phone: undefined,
          }
        : given
    const id = copyFor(stop, reader)
    if (!stop.anchor) return [{ id }]
    const box = locate(tourAnchorSelector(stop.anchor))
    if (!box) return []
    const side = cardSide(box, viewport, stop.placement ?? 'below')
    const shiftX = side === 'top' ? cardShift(box, viewport) : 0
    return [
      {
        id,
        anchor: stop.anchor,
        side,
        ...(shiftX !== 0 ? { shiftX } : {}),
        ...(side === 'right' ? { middleY: (box.top + box.bottom) / 2 } : {}),
      },
    ]
  })
}

function copyFor(stop: TourStop, reader: TourReader): string {
  if (stop.shelflessId && !reader.canAccessOfficeShelf) return stop.shelflessId
  if (stop.arrivalId && !reader.handover) return stop.arrivalId
  if (stop.memberId && !reader.canManageOrganization) return stop.memberId
  return stop.id
}

export function withoutTourRequest(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete(TOUR_QUERY_PARAM)
  const rest = params.toString()
  return rest ? `${pathname}?${rest}` : pathname
}

export function requestedTour(search: string): TourId | null {
  const value = new URLSearchParams(search).get(TOUR_QUERY_PARAM)
  return value === 'welcome' || value === 'project' ? value : null
}
