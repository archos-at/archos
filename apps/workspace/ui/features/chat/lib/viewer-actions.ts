import { create } from 'zustand'
import { MAX_VIEWER_PASSAGE_CHARS, type WireEvent } from '@/adapters/api/wire-v2'
import { capturePosthog } from '@/lib/analytics/posthog'

export const VIEWER_ACTION_NAMES = [
  'open_document',
  'highlight_passage',
  'highlight_region',
  'compare_revisions',
  'focus_ifc_element',
] as const
export type ViewerActionName = (typeof VIEWER_ACTION_NAMES)[number]

export const VIEWER_CLIENT_TOOL = 'show_in_viewer'

type WireViewerAction = Extract<WireEvent, { type: 'CUSTOM'; name: 'viewer_action' }>['value']

export type ViewerActionCall = Omit<WireViewerAction, 'tool_call_name'> & { tool_call_name: ViewerActionName }

const KNOWN: ReadonlySet<string> = new Set(VIEWER_ACTION_NAMES)

export const isViewerAction = (call: WireViewerAction): call is ViewerActionCall => KNOWN.has(call.tool_call_name)

export type ViewerActionStatus = 'held' | 'pending' | 'shown' | 'offered' | 'refused' | 'failed' | 'undone' | 'kept'
export type OfferReason = 'off' | 'typing' | 'leaves' | 'noRoom' | 'unavailable' | 'another'
export type RefusalReason = 'unavailable' | 'notRevisions'

export type ShownWhere = 'beside' | 'over' | 'compare' | 'model'

export interface ViewerActionEntry {
  call: ViewerActionCall
  answerId: string
  status: ViewerActionStatus
  reason?: OfferReason
  refusal?: RefusalReason
  where?: ShownWhere
  left?: true
}

export type ViewerActionUndo = () => boolean

export type ViewerActionOutcome =
  | {
      outcome: 'shown'
      where: ShownWhere
      undo: ViewerActionUndo
      undoable?: () => boolean
    }
  | { outcome: 'refused'; reason: RefusalReason }
  | { outcome: 'failed' }

export interface ViewerActionRunner {
  hasRoom: () => boolean
  run: (call: ViewerActionCall) => Promise<ViewerActionOutcome>
}

export const TYPING_PAUSE_MS = 1500
export const TYPING_WAIT_MS = 8000
const TYPING_POLL_MS = 250
export const VIEWER_ACTIONS_AUTO_KEY = 'viewerActions.auto'

let runner: ViewerActionRunner | null = null
const undos = new Map<string, ViewerActionUndo>()
const undoables = new Map<string, () => boolean>()

const readAuto = (): boolean => {
  try {
    const stored = window.localStorage.getItem(VIEWER_ACTIONS_AUTO_KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch {
    // Storage unavailable: fall through to the system's wish.
  }
  return typeof window.matchMedia !== 'function' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface ViewerActionState {
  entries: Record<string, ViewerActionEntry>
  byAnswer: Record<string, string[]>
  latestAnswer: string | null
  auto: boolean | null
  besideChat: boolean
}

export const useViewerActionStore = create<ViewerActionState>(() => ({
  entries: {},
  byAnswer: {},
  latestAnswer: null,
  auto: null,
  besideChat: false,
}))

const record = (entry: ViewerActionEntry): void => {
  if (entry.status === 'held' || entry.status === 'pending') return
  capturePosthog('viewer_action_outcome', {
    action: entry.call.tool_call_name,
    outcome: entry.status,
    reason: entry.reason ?? entry.refusal ?? null,
  })
}

const patch = (id: string, next: Partial<ViewerActionEntry>): void => {
  const entry = useViewerActionStore.getState().entries[id]
  if (!entry) return
  const updated = { ...entry, ...next }
  useViewerActionStore.setState((state) => ({ entries: { ...state.entries, [id]: updated } }))
  if (next.status && next.status !== entry.status) record(updated)
}

export const registerViewerActionRunner = (next: ViewerActionRunner): (() => void) => {
  runner = next
  useViewerActionStore.setState({ besideChat: next.hasRoom() })
  return () => {
    if (runner !== next) return
    runner = null
    useViewerActionStore.setState({ besideChat: false })
  }
}

export const noteViewerRoom = (room: boolean): void => {
  const besideChat = room && runner !== null
  if (useViewerActionStore.getState().besideChat !== besideChat) useViewerActionStore.setState({ besideChat })
}

export const autoPreference = (state: { auto: boolean | null }): boolean =>
  state.auto ?? (typeof window === 'undefined' ? false : readAuto())

export const viewerActionsAuto = (): boolean => autoPreference(useViewerActionStore.getState())

export const setViewerActionsAuto = (on: boolean): void => {
  useViewerActionStore.setState({ auto: on })
  capturePosthog('viewer_actions_auto_changed', { on })
  try {
    window.localStorage.setItem(VIEWER_ACTIONS_AUTO_KEY, on ? 'on' : 'off')
  } catch {
    // Storage unavailable: the choice holds for this page.
  }
}

export const viewerClientTools = (): string[] =>
  useViewerActionStore.getState().besideChat ? [VIEWER_CLIENT_TOOL] : []

export const useViewerBesideChat = (): boolean => useViewerActionStore((state) => state.besideChat)

let lastTypedAt = Number.NEGATIVE_INFINITY
let listening = false

const editable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
}

const listenForTyping = (): void => {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener(
    'keydown',
    (event) => {
      if (editable(event.target)) lastTypedAt = Date.now()
    },
    { capture: true }
  )
}

export const isTyping = (now = Date.now()): boolean => now - lastTypedAt < TYPING_PAUSE_MS

const pause = async (): Promise<boolean> => {
  const until = Date.now() + TYPING_WAIT_MS
  while (isTyping()) {
    if (Date.now() >= until) return false
    await new Promise((resolve) => setTimeout(resolve, TYPING_POLL_MS))
  }
  return true
}

const execute = async (id: string): Promise<void> => {
  const entry = useViewerActionStore.getState().entries[id]
  if (!entry || !runner) {
    patch(id, { status: 'offered', reason: 'unavailable' })
    return
  }
  const result = await runner.run(entry.call).catch((): ViewerActionOutcome => ({ outcome: 'failed' }))
  if (result.outcome === 'shown') {
    undos.set(id, result.undo)
    if (result.undoable) undoables.set(id, result.undoable)
    patch(id, { status: 'shown', reason: undefined, where: result.where })
    return
  }
  if (result.outcome === 'refused') {
    patch(id, { status: 'refused', refusal: result.reason })
    return
  }
  patch(id, { status: 'failed' })
}

export const CONTEXT_CHANGING: ReadonlySet<ViewerActionName> = new Set(['compare_revisions', 'focus_ifc_element'])

const offerReason = (call: ViewerActionCall): OfferReason | null => {
  if (CONTEXT_CHANGING.has(call.tool_call_name)) return 'leaves'
  if (!viewerActionsAuto()) return 'off'
  if (!runner) return 'unavailable'
  if (!runner.hasRoom()) return 'noRoom'
  return null
}

export const proposeViewerAction = (answerId: string, call: ViewerActionCall): void => {
  const id = call.tool_call_id
  if (useViewerActionStore.getState().entries[id]) return
  listenForTyping()
  useViewerActionStore.setState((state) => ({
    entries: { ...state.entries, [id]: { call, answerId, status: 'held' } },
    byAnswer: { ...state.byAnswer, [answerId]: [...(state.byAnswer[answerId] ?? []), id] },
    latestAnswer: answerId,
  }))
}

export const releaseViewerActions = async (answerId: string): Promise<void> => {
  const ids = useViewerActionStore.getState().byAnswer[answerId] ?? []
  const statusOf = (id: string) => useViewerActionStore.getState().entries[id]?.status
  const held = ids.filter((id) => statusOf(id) === 'held')
  let moved = ids.some((id) => statusOf(id) === 'pending' || statusOf(id) === 'shown')
  for (const id of held) {
    const entry = useViewerActionStore.getState().entries[id]
    if (!entry) continue
    const reason = moved ? 'another' : offerReason(entry.call)
    if (reason) {
      patch(id, { status: 'offered', reason })
      continue
    }
    moved = true
    patch(id, { status: 'pending' })
    if (!(await pause())) {
      patch(id, { status: 'offered', reason: 'typing' })
      continue
    }
    await execute(id)
  }
}

export const dropViewerActions = (answerId: string): void => {
  const state = useViewerActionStore.getState()
  const ids = state.byAnswer[answerId] ?? []
  const dropped = ids.filter((id) => state.entries[id]?.status === 'held')
  if (dropped.length === 0) return
  const entries = { ...state.entries }
  for (const id of dropped) delete entries[id]
  const kept = ids.filter((id) => !dropped.includes(id))
  const byAnswer = { ...state.byAnswer }
  if (kept.length) byAnswer[answerId] = kept
  else delete byAnswer[answerId]
  useViewerActionStore.setState({ entries, byAnswer })
}

export const runViewerActionNow = async (call: ViewerActionCall): Promise<ViewerActionOutcome> => {
  if (!runner) return { outcome: 'failed' }
  return runner.run(call).catch((): ViewerActionOutcome => ({ outcome: 'failed' }))
}

const asWireRegion = (box: readonly [number, number, number, number]): number[] => [
  box[0],
  box[1],
  Math.max(0, box[2] - box[0]),
  Math.max(0, box[3] - box[1]),
]

export const citationViewerAction = (cited: {
  documentId: string
  documentName: string
  page: number | null | undefined
  passage?: string | null
  box?: readonly [number, number, number, number] | null
}): ViewerActionCall => {
  const base = {
    document_id: cited.documentId,
    document_name: cited.documentName,
    page: cited.page ?? null,
    passage: null,
    region: null,
    against_document_id: null,
    against_document_name: null,
    element: null,
  }
  const id = `cite_${Date.now().toString(36)}`
  if (cited.page && cited.box) {
    return { tool_call_id: id, tool_call_name: 'highlight_region', args: { ...base, region: asWireRegion(cited.box) } }
  }
  const passage = cited.passage?.trim().slice(0, MAX_VIEWER_PASSAGE_CHARS)
  if (cited.page && passage) {
    return { tool_call_id: id, tool_call_name: 'highlight_passage', args: { ...base, passage } }
  }
  return { tool_call_id: id, tool_call_name: 'open_document', args: base }
}

export const showViewerAction = (id: string): Promise<void> => {
  if (useViewerActionStore.getState().entries[id]?.status === 'held') patch(id, { status: 'pending' })
  return execute(id)
}

export const undoViewerAction = (id: string): void => {
  const undo = undos.get(id)
  if (!undo) return
  undos.delete(id)
  undoables.delete(id)
  patch(id, { status: undo() ? 'undone' : 'kept' })
}

export const noteViewerLocation = (): void => {
  for (const [id, undoable] of [...undoables]) {
    if (undoable()) continue
    undoables.delete(id)
    undos.delete(id)
    patch(id, { left: true })
  }
}

export const viewerActionsOf = (state: ViewerActionState, answerId: string): ViewerActionEntry[] =>
  (state.byAnswer[answerId] ?? []).flatMap((id) => {
    const entry = state.entries[id]
    return entry ? [entry] : []
  })

export const newViewerActions = (
  previous: readonly WireViewerAction[] | undefined,
  next: readonly WireViewerAction[] | undefined
): ViewerActionCall[] => {
  if (!next || next === previous) return []
  const seen = new Set((previous ?? []).map((call) => call.tool_call_id))
  return next.filter((call) => !seen.has(call.tool_call_id)).filter(isViewerAction)
}

export const resetViewerActions = (): void => {
  useViewerActionStore.setState({ entries: {}, byAnswer: {}, latestAnswer: null, auto: null, besideChat: false })
  undos.clear()
  undoables.clear()
  runner = null
  lastTypedAt = Number.NEGATIVE_INFINITY
}

export const noteTypedAt = (at: number): void => {
  lastTypedAt = at
}
