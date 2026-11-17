'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

const OPEN_DELAY_MS = 130
const CLOSE_DELAY_MS = 220
const WARM_WINDOW_MS = 300

interface OpenPeek {
  replace: () => void
  isPinned: () => boolean
  isLeaving: () => boolean
  anchor: () => HTMLElement | null
}
let currentPeek: OpenPeek | null = null
let lastClosedAt = Number.NEGATIVE_INFINITY

const onSameLine = (a: HTMLElement | null, b: HTMLElement | null): boolean => {
  if (!a || !b) return false
  const ra = a.getBoundingClientRect()
  const rb = b.getBoundingClientRect()
  return Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 0
}

const isWarm = (self: OpenPeek): boolean => {
  const open = currentPeek
  if (open !== null && open !== self && !open.isPinned()) {
    return open.isLeaving() || onSameLine(open.anchor(), self.anchor())
  }
  return performance.now() - lastClosedAt < WARM_WINDOW_MS
}

interface TriggerProps {
  ref: (node: HTMLElement | null) => void
  'aria-expanded': boolean
  'aria-haspopup': 'dialog'
  onPointerEnter: (event: PointerEvent) => void
  onPointerLeave: (event: PointerEvent) => void
  onPointerDown: () => void
  onFocus: () => void
  onBlur: () => void
  onClick: () => void
}

interface ContentProps {
  onPointerEnter: () => void
  onPointerLeave: () => void
  onOpenAutoFocus: (event: Event) => void
  onInteractOutside: (event: Event) => void
}

export interface HoverPopover {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerProps: TriggerProps
  contentProps: ContentProps
  dismiss: () => void
  engaged: boolean
  anchorRef: RefObject<HTMLElement | null>
  skipExit: boolean
}

export const useHoverPopover = (): HoverPopover => {
  const [open, setOpen] = useState(false)
  const [engaged, setEngaged] = useState(false)
  const [skipExit, setSkipExit] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const pinned = useRef(false)
  const leaving = useRef(false)
  const timer = useRef<number | null>(null)

  const setAnchor = useCallback((node: HTMLElement | null): void => {
    anchorRef.current = node
  }, [])

  const engage = (): void => {
    if (!engaged) setEngaged(true)
  }

  const cancel = useCallback((): void => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const schedule = useCallback(
    (next: boolean, delay: number): void => {
      cancel()
      timer.current = window.setTimeout(() => {
        timer.current = null
        if (next) setSkipExit(false)
        setOpen(next)
      }, delay)
    },
    [cancel]
  )

  const dismiss = useCallback((): void => {
    cancel()
    pinned.current = false
    setOpen(false)
  }, [cancel])

  useEffect(() => cancel, [cancel])

  const [self] = useState<OpenPeek>(() => ({
    replace: () => {
      cancel()
      pinned.current = false
      setSkipExit(true)
      setOpen(false)
    },
    isPinned: () => pinned.current,
    isLeaving: () => leaving.current,
    anchor: () => anchorRef.current,
  }))

  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      if (currentPeek && currentPeek !== self && !currentPeek.isPinned()) currentPeek.replace()
      currentPeek = self
      return
    }
    leaving.current = false
    if (currentPeek === self) currentPeek = null
    if (wasOpen.current) lastClosedAt = performance.now()
    wasOpen.current = false
  }, [open, self])

  useEffect(
    () => () => {
      if (currentPeek === self) currentPeek = null
    },
    [self]
  )

  const show = (): void => {
    leaving.current = false
    setSkipExit(false)
    setOpen(true)
  }

  return {
    open,
    skipExit,
    onOpenChange: (next) => {
      if (!next) dismiss()
    },
    dismiss,
    engaged,
    anchorRef,
    triggerProps: {
      ref: setAnchor,
      'aria-expanded': open,
      'aria-haspopup': 'dialog',
      onPointerEnter: (event) => {
        engage()
        leaving.current = false
        if (event.pointerType !== 'mouse') return
        if (isWarm(self)) {
          cancel()
          show()
          return
        }
        schedule(true, OPEN_DELAY_MS)
      },
      onPointerLeave: (event) => {
        if (event.pointerType !== 'mouse') return
        if (pinned.current) {
          cancel()
          return
        }
        schedule(false, CLOSE_DELAY_MS)
      },
      onPointerDown: engage,
      onFocus: () => {
        engage()
        cancel()
        show()
      },
      onBlur: () => {
        if (!pinned.current) schedule(false, CLOSE_DELAY_MS)
      },
      onClick: () => {
        engage()
        cancel()
        if (pinned.current) {
          dismiss()
          return
        }
        pinned.current = true
        show()
      },
    },
    contentProps: {
      onPointerEnter: () => {
        leaving.current = false
        cancel()
      },
      onPointerLeave: () => {
        if (pinned.current) return
        leaving.current = true
        schedule(false, CLOSE_DELAY_MS)
      },
      onOpenAutoFocus: (event) => {
        if (!pinned.current) event.preventDefault()
      },
      onInteractOutside: (event) => {
        const target = event.target
        if (target instanceof Node && anchorRef.current?.contains(target)) event.preventDefault()
      },
    },
  }
}
