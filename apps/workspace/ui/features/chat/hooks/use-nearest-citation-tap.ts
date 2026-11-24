import type { MouseEvent } from 'react'
import { NEAREST_MARKER_REACH_PX, nearestMarkerIndex } from '../lib/nearest-marker'

const PRESSABLE_SELECTOR =
  'a[href], button, summary, input, textarea, select, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [data-no-citation-tap]'

const MARKER_SELECTOR = 'button[data-citation-marker]'

const handleNearestCitationTap = (event: MouseEvent<HTMLElement>): void => {
  if (event.defaultPrevented) return
  if (typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches) return
  const frame = event.currentTarget
  const target = event.target
  if (!(target instanceof Element) || !frame.contains(target) || target.closest(PRESSABLE_SELECTOR)) return
  if (window.getSelection()?.toString()) return
  const markers = Array.from(frame.querySelectorAll<HTMLButtonElement>(MARKER_SELECTOR))
  if (markers.length === 0) return
  const index = nearestMarkerIndex(
    event.clientX,
    event.clientY,
    markers.map((marker) => marker.getBoundingClientRect())
  )
  if (index < 0) return
  markers[index]?.click()
}

/** Spread on the frame that holds the markers: a tap beside one opens it, and the reach is declared where a measurement can see it. */
export const nearestCitationTapFrame = { onClick: handleNearestCitationTap, 'data-tap-reach': NEAREST_MARKER_REACH_PX } as const
