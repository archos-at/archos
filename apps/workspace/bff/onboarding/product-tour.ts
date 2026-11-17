export type TourId = 'welcome' | 'project'

export const TOUR_QUERY_PARAM = 'tour'

export const TOUR_HOME = '/app/projects'

export function tourStartUrl(path: string, tour: TourId): string {
  return `${path}?${TOUR_QUERY_PARAM}=${tour}`
}

export const TOUR_START_URL = tourStartUrl(TOUR_HOME, 'welcome')

export function projectTourUrl(projectId: string): string {
  return tourStartUrl(`/app/projects/${projectId}/chat`, 'project')
}

export const TOUR_ANCHORS = {
  createProject: 'create-project',
  officeShelf: 'office-shelf',
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
  phone?: { id: string; anchor?: TourAnchor; placement?: TourPlacement }
}

export interface PlacedTourStop extends TourStop {
  side?: TourSide
  shiftX?: number
}

const WELCOME_STOPS: readonly TourStop[] = [
  { id: 'welcome', arrivalId: 'welcomeJoined' },
  { id: 'createProject', anchor: TOUR_ANCHORS.createProject, placement: 'below', arrivalId: 'createProjectJoined' },
  { id: 'officeShelf', anchor: TOUR_ANCHORS.officeShelf, placement: 'below', gate: 'canAccessOfficeShelf' },
  { id: 'inbox', anchor: TOUR_ANCHORS.inbox, placement: 'below', gate: 'canAccessInbox' },
  { id: 'account', anchor: TOUR_ANCHORS.account, placement: 'below', memberId: 'accountMember' },
  { id: 'shortcuts', phone: { id: 'searchPhone', anchor: TOUR_ANCHORS.search, placement: 'below' } },
]

const PROJECT_STOPS: readonly TourStop[] = [
  { id: 'projectWelcome', arrivalId: 'projectWelcomeJoined' },
  { id: 'projectChat', anchor: TOUR_ANCHORS.sectionChat, placement: 'beside' },
  { id: 'projectFiles', anchor: TOUR_ANCHORS.sectionFiles, placement: 'beside' },
  {
    id: 'projectOfficeShelf',
    anchor: TOUR_ANCHORS.sectionOfficeShelf,
    placement: 'beside',
    gate: 'canAccessOfficeShelf',
    phone: { id: 'projectOfficeShelfPhone', anchor: TOUR_ANCHORS.more },
  },
  { id: 'filesOrOfficeShelf', gate: 'canAccessOfficeShelf' },
  { id: 'projectSources' },
  { id: 'projectSettings', anchor: TOUR_ANCHORS.sectionSettings, placement: 'beside' },
]

export const TOURS: Record<TourId, readonly TourStop[]> = {
  welcome: WELCOME_STOPS,
  project: PROJECT_STOPS,
}

export const ARRIVAL_ANCHOR: Record<TourId, TourAnchor | null> = {
  welcome: TOUR_ANCHORS.createProject,
  project: null,
}

export function tourForPath(pathname: string): TourId | null {
  if (pathname === TOUR_HOME) return 'welcome'
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

export function placeStops(
  stops: readonly TourStop[],
  reader: TourReader,
  locate: (selector: string) => AnchorBox | null,
  viewport: Viewport,
): PlacedTourStop[] {
  return stops.flatMap((given): PlacedTourStop[] => {
    if (given.gate && !reader[given.gate]) return []
    const stop: TourStop =
      reader.phone && given.phone
        ? { ...given, ...given.phone, arrivalId: undefined, memberId: undefined, phone: undefined }
        : given
    const id = copyFor(stop, reader)
    if (!stop.anchor) return [{ id }]
    const box = locate(tourAnchorSelector(stop.anchor))
    if (!box) return [{ id }]
    const side = cardSide(box, viewport, stop.placement ?? 'below')
    const shiftX = side === 'top' ? cardShift(box, viewport) : 0
    return [{ id, anchor: stop.anchor, side, ...(shiftX !== 0 ? { shiftX } : {}) }]
  })
}

function copyFor(stop: TourStop, reader: TourReader): string {
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
