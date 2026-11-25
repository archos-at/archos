'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { toast, type ExternalToast } from 'sonner'

export const FILING_HOLD_MS = 5000

export interface HoldInput {
  ids: readonly string[]
  label: string
  undoLabel: string
  run: (toastId: string | number, options: { keepalive: boolean }) => Promise<boolean>
  onUndo: () => void
  toastOptions?: ExternalToast
}

interface Hold extends HoldInput {
  toastId: string | number
}

/** Held filings belong to the page, not to one mail's render: moving to the next mail remounts the workspace, and that must not send them. */
const holds = new Map<number, Hold>()
let hidden: ReadonlySet<string> = new Set()
let settled = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function setHidden(next: ReadonlySet<string>): void {
  hidden = next
  emit()
}

function fire(key: number, keepalive: boolean): void {
  const entry = holds.get(key)
  if (!entry) return
  holds.delete(key)
  window.clearTimeout(key)
  toast.loading(entry.label, { ...entry.toastOptions, id: entry.toastId, action: undefined })
  void entry
    .run(entry.toastId, { keepalive })
    .then(
      (filed) => filed,
      () => false
    )
    .then((filed) => {
      if (!filed) setHidden(new Set([...hidden].filter((id) => !entry.ids.includes(id))))
      settled += 1
      emit()
    })
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => [...holds.keys()].forEach((key) => fire(key, true)))
}

function hold(input: HoldInput, holdMs: number): void {
  const key = window.setTimeout(() => fire(key, false), holdMs)
  const toastId = toast.loading(input.label, {
    ...input.toastOptions,
    action: {
      label: input.undoLabel,
      onClick: () => {
        if (!holds.delete(key)) return
        window.clearTimeout(key)
        toast.dismiss(toastId)
        setHidden(new Set([...hidden].filter((id) => !input.ids.includes(id))))
        input.onUndo()
      },
    },
  })
  holds.set(key, { ...input, toastId })
  setHidden(new Set([...hidden, ...input.ids]))
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface HeldFilings {
  hidden: ReadonlySet<string>
  settled: number
  hold: (input: HoldInput) => void
}

export function useHeldFilings(holdMs = FILING_HOLD_MS): HeldFilings {
  const hiddenNow = useSyncExternalStore(subscribe, () => hidden, () => hidden)
  const settledNow = useSyncExternalStore(subscribe, () => settled, () => settled)
  const holdIt = useCallback((input: HoldInput) => hold(input, holdMs), [holdMs])
  return { hidden: hiddenNow, settled: settledNow, hold: holdIt }
}

export function resetHeldFilingsForTests(): void {
  for (const key of holds.keys()) window.clearTimeout(key)
  holds.clear()
  hidden = new Set()
  settled = 0
}
