'use client'

import * as React from 'react'
import { animate } from 'motion/react'

import { springGlide, useMotionToken } from '@/components/motion'

export const SHEET_DISMISS_DISTANCE_PX = 96

export const SHEET_DISMISS_VELOCITY_PX_S = 600

const FLICK_WINDOW_MS = 80

export function pullDismisses(offset: number, velocity: number): boolean {
  return offset > SHEET_DISMISS_DISTANCE_PX || velocity > SHEET_DISMISS_VELOCITY_PX_S
}

interface Pull {
  pointerId: number
  panel: HTMLElement
  startY: number
  offset: number
  lastY: number
  lastTime: number
  velocity: number
}

type PullHandlers = Required<
  Pick<React.HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>
>

export function useSheetPull(dismiss: () => void): PullHandlers {
  const pull = React.useRef<Pull | null>(null)
  const snapBack = useMotionToken(springGlide)

  const settle = React.useCallback(
    (panel: HTMLElement, offset: number) => {
      if (offset <= 0) {
        panel.style.transform = ''
        return
      }
      void animate(panel, { y: [offset, 0] }, snapBack).then(() => {
        panel.style.transform = ''
      })
    },
    [snapBack]
  )

  return React.useMemo<PullHandlers>(
    () => ({
      onPointerDown: (event) => {
        if (event.button !== 0) return
        const panel = event.currentTarget.closest<HTMLElement>('[data-slot="dialog-content"]')
        if (!panel) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        pull.current = {
          pointerId: event.pointerId,
          panel,
          startY: event.clientY,
          offset: 0,
          lastY: event.clientY,
          lastTime: event.timeStamp,
          velocity: 0,
        }
      },
      onPointerMove: (event) => {
        const current = pull.current
        if (!current || current.pointerId !== event.pointerId) return
        const elapsed = event.timeStamp - current.lastTime
        const step = event.clientY - current.lastY
        if (step === 0) current.velocity = 0
        else if (elapsed > 0) current.velocity = (step / elapsed) * 1000
        current.lastY = event.clientY
        current.lastTime = event.timeStamp
        current.offset = Math.max(0, event.clientY - current.startY)
        current.panel.style.transform = `translateY(${current.offset}px)`
      },
      onPointerUp: (event) => {
        const current = pull.current
        if (!current || current.pointerId !== event.pointerId) return
        pull.current = null
        const velocity = event.timeStamp - current.lastTime > FLICK_WINDOW_MS ? 0 : current.velocity
        if (!pullDismisses(current.offset, velocity)) {
          settle(current.panel, current.offset)
          return
        }
        dismiss()
        requestAnimationFrame(() => {
          if (current.panel.isConnected && current.panel.dataset.state === 'open') {
            settle(current.panel, current.offset)
          }
        })
      },
      onPointerCancel: (event) => {
        const current = pull.current
        if (!current || current.pointerId !== event.pointerId) return
        pull.current = null
        settle(current.panel, current.offset)
      },
    }),
    [dismiss, settle]
  )
}
