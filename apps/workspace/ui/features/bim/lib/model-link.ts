import type { BimHighlightStatus } from './model-index'
import {
  defaultCameraState,
  encodeCameraState,
  parseCameraState,
  type BimViewerCameraState,
} from './viewer-camera'

export const BIM_MODEL_TABS = [
  'overview',
  'compliance',
  'structure',
  'quantities',
  'revisions',
] as const
export type BimModelTab = (typeof BIM_MODEL_TABS)[number]

const TABS = new Set<string>(BIM_MODEL_TABS)

export interface BimModelView {
  model?: string
  tab?: BimModelTab
  storey?: string
  element?: string
  highlights?: Array<{
    status: BimHighlightStatus
    label?: string
    globalIds: string[]
    total?: number
  }>
  xray?: boolean
  camera?: BimViewerCameraState
}

const STATUSES = new Set<BimHighlightStatus>(['pass', 'fail', 'warning', 'info'])

const MAX_LINK_IDS = 60

export function buildModelQuery(view: BimModelView): string {
  const params = new URLSearchParams()
  if (view.model) params.set('model', view.model)
  if (view.tab) params.set('tab', view.tab)
  if (view.storey) params.set('storey', view.storey)
  if (view.element) params.set('element', view.element)
  for (const group of view.highlights ?? []) {
    const ids = group.globalIds.slice(0, MAX_LINK_IDS)
    if (ids.length === 0) continue
    const label = encodeURIComponent(group.label ?? '')
    const total = group.total ?? group.globalIds.length
    const suffix = total > ids.length ? `+${total}` : ''
    const middle = `${label}${suffix}`
    params.append(
      'hl',
      middle ? `${group.status}:${middle}:${ids.join(',')}` : `${group.status}:${ids.join(',')}`
    )
  }
  if (view.xray) params.set('xray', '1')
  if (view.camera) encodeCameraState(view.camera, params)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const MODEL_VIEW_SEGMENT = 'files'

export const OFFICE_SHELF_MODEL_PATH = '/app/office-shelf'

export function buildModelHref(projectId: string, view: BimModelView = {}): string {
  return `/app/projects/${projectId}/${MODEL_VIEW_SEGMENT}${buildModelQuery(view)}`
}

export function buildOfficeShelfModelHref(view: BimModelView = {}): string {
  return `${OFFICE_SHELF_MODEL_PATH}${buildModelQuery(view)}`
}

export function parseModelView(search: string | URLSearchParams): BimModelView {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const view: BimModelView = {}

  const model = params.get('model')?.trim()
  if (model) view.model = model
  const tab = params.get('tab')?.trim()
  if (tab && TABS.has(tab)) view.tab = tab as BimModelTab
  const storey = params.get('storey')?.trim()
  if (storey) view.storey = storey
  const element = params.get('element')?.trim()
  if (element) view.element = element
  if (params.get('xray') === '1') view.xray = true

  const camera = parseCameraState(params)
  const fallback = defaultCameraState()
  const isDefault =
    camera.view === fallback.view &&
    camera.section === null &&
    camera.orthographic === fallback.orthographic
  if (!isDefault) view.camera = camera

  const highlights: NonNullable<BimModelView['highlights']> = []
  for (const raw of params.getAll('hl')) {
    const separator = raw.indexOf(':')
    if (separator <= 0) continue
    const status = raw.slice(0, separator) as BimHighlightStatus
    if (!STATUSES.has(status)) continue

    const rest = raw.slice(separator + 1)
    const second = rest.indexOf(':')
    const middle = second >= 0 ? rest.slice(0, second) : ''
    const idPart = second >= 0 ? rest.slice(second + 1) : rest

    const plus = middle.lastIndexOf('+')
    const totalText = plus >= 0 ? middle.slice(plus + 1) : ''
    const total = /^\d+$/.test(totalText) ? Number(totalText) : undefined
    const encodedLabel = plus >= 0 && total !== undefined ? middle.slice(0, plus) : middle
    let label: string | undefined
    try {
      label = decodeURIComponent(encodedLabel) || undefined
    } catch {
      label = undefined
    }

    const globalIds = idPart
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, MAX_LINK_IDS)
    if (globalIds.length === 0) continue
    highlights.push({ status, ...(label ? { label } : {}), globalIds, ...(total ? { total } : {}) })
  }
  if (highlights.length > 0) view.highlights = highlights

  return view
}

export function withModelView(current: BimModelView, patch: Partial<BimModelView>): BimModelView {
  const next: BimModelView = { ...current }
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof BimModelView, BimModelView[keyof BimModelView]]
  >) {
    if (value === undefined || value === null || value === '' || value === false) delete next[key]
    else Object.assign(next, { [key]: value })
  }
  return next
}
