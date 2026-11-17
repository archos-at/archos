import { animate } from 'motion/react'
import { springGlide } from '@/components/motion'

export interface GlideHandle {
  stop: () => void
}

const NOOP: GlideHandle = { stop: () => {} }

const READER_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const

export const glideScrollTo = (
  container: HTMLElement,
  top: number,
  { reducedMotion }: { reducedMotion: boolean }
): GlideHandle => {
  const max = Math.max(0, container.scrollHeight - container.clientHeight)
  const to = Math.min(max, Math.max(0, top))
  const from = container.scrollTop
  if (reducedMotion || Math.abs(to - from) < 1) {
    container.scrollTop = to
    return NOOP
  }

  let start = from
  const viewport = container.clientHeight
  if (Math.abs(to - from) > 1.5 * viewport) {
    start = to - Math.sign(to - from) * (viewport / 2)
    container.scrollTop = start
  }

  let stopped = false
  const controls = animate(start, to, {
    ...springGlide,
    onUpdate: (value) => {
      container.scrollTop = value
    },
  })
  const detach = () => {
    for (const type of READER_EVENTS) container.removeEventListener(type, stop)
    window.removeEventListener('keydown', stop)
  }
  function stop() {
    if (stopped) return
    stopped = true
    controls.stop()
    detach()
  }
  for (const type of READER_EVENTS) container.addEventListener(type, stop, { passive: true })
  window.addEventListener('keydown', stop)
  void controls.then(detach, detach)
  return { stop }
}
