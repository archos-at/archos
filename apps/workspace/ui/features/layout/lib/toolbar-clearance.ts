export const TOOLBAR_CLEAR_VAR = '--chat-toolbar-clear'

export const TOOLBAR_BREATH_PX = 8

export const TOOLBAR_CLEAR_PADDING =
  'pt-[var(--chat-toolbar-clear,max(5rem,calc(env(safe-area-inset-top)+4rem)))] sm:pt-[var(--chat-toolbar-clear,max(3.5rem,calc(env(safe-area-inset-top)+3rem)))]'

export const TOOLBAR_CLEAR_SCROLL_MARGIN =
  'scroll-mt-[var(--chat-toolbar-clear,max(5rem,calc(env(safe-area-inset-top)+4rem)))] sm:scroll-mt-[var(--chat-toolbar-clear,max(3.5rem,calc(env(safe-area-inset-top)+3rem)))]'

export function toolbarClearance(heightPx: number): string {
  return `${Math.ceil(heightPx) + TOOLBAR_BREATH_PX}px`
}
