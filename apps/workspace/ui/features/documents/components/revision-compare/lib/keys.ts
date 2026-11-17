import type { CompareMode } from '../types'

export type CompareKeyAction =
  | { type: 'page'; delta: 1 | -1 }
  | { type: 'edge'; edge: 'first' | 'last' }
  | { type: 'mode'; mode: CompareMode }

const MODE_KEYS: Record<string, CompareMode> = { '1': 'side', '2': 'overlay', '3': 'swipe' }

interface KeyLike {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export function compareKeyAction(event: KeyLike): CompareKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === 'ArrowRight' || event.key === 'PageDown') return { type: 'page', delta: 1 }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') return { type: 'page', delta: -1 }
  if (event.key === 'Home') return { type: 'edge', edge: 'first' }
  if (event.key === 'End') return { type: 'edge', edge: 'last' }
  const mode = MODE_KEYS[event.key]
  return mode ? { type: 'mode', mode } : null
}

const TEXT_TAGS = new Set(['TEXTAREA', 'SELECT'])
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

export function keyBelongsToTarget(key: string, target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || TEXT_TAGS.has(target.tagName)) return true
  const isRange = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'range'
  if (target.tagName === 'INPUT' && !isRange) return true
  return SLIDER_KEYS.has(key) && (isRange || target.getAttribute('role') === 'slider')
}
