export type ResumeCause = 'visible' | 'online' | 'pageshow'

export interface PageLifecycleListener {
  resume: (cause: ResumeCause) => void
  suspend?: () => void
}

export interface PageLifecycle {
  readonly visible: boolean
  readonly online: boolean
  subscribe: (listener: PageLifecycleListener) => () => void
}

export const ALWAYS_ACTIVE: PageLifecycle = {
  visible: true,
  online: true,
  subscribe: () => () => undefined,
}

export interface PageLifecycleGlobals {
  document: EventTarget & { readonly visibilityState: DocumentVisibilityState }
  window: EventTarget
  navigator: { readonly onLine: boolean }
}

const browserGlobals = (): PageLifecycleGlobals | null =>
  typeof document === 'undefined' ||
  typeof window === 'undefined' ||
  typeof navigator === 'undefined'
    ? null
    : { document, window, navigator }

export function browserPageLifecycle(
  globals: PageLifecycleGlobals | null = browserGlobals()
): PageLifecycle {
  if (!globals) return ALWAYS_ACTIVE
  const { document: doc, window: win, navigator: nav } = globals
  let cached = false
  const visible = () => !cached && doc.visibilityState !== 'hidden'
  return {
    get visible() {
      return visible()
    },
    get online() {
      return nav.onLine !== false
    },
    subscribe(listener) {
      cached = false
      const active = () => visible() && nav.onLine !== false
      const onVisibility = () => {
        if (doc.visibilityState === 'hidden') listener.suspend?.()
        else if (active()) listener.resume('visible')
      }
      const onOnline = () => {
        if (active()) listener.resume('online')
      }
      const onOffline = () => listener.suspend?.()
      const onPageShow = (event: Event) => {
        cached = false
        if ((event as PageTransitionEvent).persisted && active()) listener.resume('pageshow')
      }
      const onPageHide = (event: Event) => {
        if (!(event as PageTransitionEvent).persisted) return
        cached = true
        listener.suspend?.()
      }
      doc.addEventListener('visibilitychange', onVisibility)
      win.addEventListener('online', onOnline)
      win.addEventListener('offline', onOffline)
      win.addEventListener('pageshow', onPageShow)
      win.addEventListener('pagehide', onPageHide)
      return () => {
        doc.removeEventListener('visibilitychange', onVisibility)
        win.removeEventListener('online', onOnline)
        win.removeEventListener('offline', onOffline)
        win.removeEventListener('pageshow', onPageShow)
        win.removeEventListener('pagehide', onPageHide)
      }
    },
  }
}

export const isActive = (lifecycle: PageLifecycle): boolean => lifecycle.visible && lifecycle.online

export const FROZEN_SLACK_MS = 5_000

export const sleptThrough = (armedAt: number, ms: number, now: number = Date.now()): boolean =>
  now - armedAt > ms + FROZEN_SLACK_MS
