import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'

export interface CanvasFocusRegion {
  page: number
  x: number
  y: number
  w: number
  h: number
  annotation_id?: string
}

export interface CanvasFocus {
  documentId: string
  fileName: string | null
  versionId: string | null
  versionState: DocumentVersionState | null
  shelf: 'session' | 'project' | 'office_shelf' | null
  region: CanvasFocusRegion | null
  replyInThread: boolean
}

export interface CanvasChatQuestion {
  text: string
  focus: CanvasFocus
  effort?: ChatEffort
}

export type CanvasChatSender = (question: CanvasChatQuestion) => { conversationId: string; turnId: string } | null

let sender: CanvasChatSender | null = null

export const registerCanvasChatSender = (next: CanvasChatSender): (() => void) => {
  sender = next
  return () => {
    if (sender === next) sender = null
  }
}

export const canvasChatSender = (): CanvasChatSender | null => sender

export type CanvasFocusProvider = () => CanvasFocus | null

let focusProvider: CanvasFocusProvider | null = null

export const registerCanvasFocusProvider = (next: CanvasFocusProvider): (() => void) => {
  focusProvider = next
  return () => {
    if (focusProvider === next) focusProvider = null
  }
}

export const openCanvasFocus = (): CanvasFocus | null => focusProvider?.() ?? null

export interface CanvasChatSteer {
  text: string
  focusRegion?: CanvasFocusRegion | null
  onLeftover?: (text: string) => void
}

export type CanvasChatSteerer = (request: CanvasChatSteer) => boolean

let steerer: CanvasChatSteerer | null = null

export const registerCanvasChatSteerer = (next: CanvasChatSteerer): (() => void) => {
  steerer = next
  return () => {
    if (steerer === next) steerer = null
  }
}

export const canvasChatSteerer = (): CanvasChatSteerer | null => steerer

export function clampFocusRegion<R extends { x: number; y: number; w: number; h: number }>(region: R): R {
  const x = Math.min(Math.max(region.x, 0), 1)
  const y = Math.min(Math.max(region.y, 0), 1)
  const w = Math.max(Math.min(region.w, 1 - x), 0.0001)
  const h = Math.max(Math.min(region.h, 1 - y), 0.0001)
  return { ...region, x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h }
}
