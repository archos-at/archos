'use client'

import { useEffect } from 'react'

export const VISUAL_VIEWPORT_HEIGHT_VAR = '--visual-viewport-height'

const OCCLUSION_THRESHOLD_PX = 1

const ZOOM_EPSILON = 0.01

const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [data-vaul-drawer], [data-radix-popper-content-wrapper]'

function focusIsInShell(): boolean {
  const focused = document.activeElement
  return !(focused instanceof Element && focused.closest(OVERLAY_SELECTOR) !== null)
}

export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    let frame = 0

    const apply = (): void => {
      frame = 0
      const layoutHeight = root.clientHeight
      const occluded =
        Math.abs(viewport.scale - 1) < ZOOM_EPSILON &&
        layoutHeight - viewport.height > OCCLUSION_THRESHOLD_PX
      if (!occluded) {
        root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_VAR)
        return
      }
      root.style.setProperty(VISUAL_VIEWPORT_HEIGHT_VAR, `${viewport.height}px`)
      if (!focusIsInShell()) return
      if (window.scrollY !== 0 || viewport.offsetTop !== 0) window.scrollTo(0, 0)
    }

    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(apply)
    }

    apply()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    return () => {
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      if (frame !== 0) cancelAnimationFrame(frame)
      root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_VAR)
    }
  }, [])
}

export const OVERLAY_INSET_BOTTOM_VAR = '--overlay-inset-bottom'

export function useFitToVisualViewport(node: HTMLElement | null): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport || !node) return

    let frame = 0
    const clear = (): void => {
      node.style.removeProperty('top')
      node.style.removeProperty('height')
      node.style.removeProperty(OVERLAY_INSET_BOTTOM_VAR)
    }
    const apply = (): void => {
      frame = 0
      const occluded =
        Math.abs(viewport.scale - 1) < ZOOM_EPSILON &&
        document.documentElement.clientHeight - viewport.height > OCCLUSION_THRESHOLD_PX
      if (!occluded) {
        clear()
        return
      }
      node.style.top = `${viewport.offsetTop}px`
      node.style.height = `${viewport.height}px`
      node.style.setProperty(OVERLAY_INSET_BOTTOM_VAR, '0px')
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(apply)
    }

    apply()
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    return () => {
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      if (frame !== 0) cancelAnimationFrame(frame)
      clear()
    }
  }, [node])
}
