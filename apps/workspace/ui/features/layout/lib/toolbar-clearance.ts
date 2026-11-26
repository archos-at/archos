export const TOOLBAR_CLEAR_VAR = '--chat-toolbar-clear'

export const TOOLBAR_BREATH_PX = 8

export const TOOLBAR_CLEAR_PADDING =
  'pt-[var(--chat-toolbar-clear,calc(max(0.5rem,var(--chat-inset-top,env(safe-area-inset-top)))+4.125rem))] sm:pt-[var(--chat-toolbar-clear,calc(max(0.5rem,var(--chat-inset-top,env(safe-area-inset-top)))+3.625rem))]'

export const TOOLBAR_CLEAR_SCROLL_MARGIN =
  'scroll-mt-[var(--chat-toolbar-clear,calc(max(0.5rem,var(--chat-inset-top,env(safe-area-inset-top)))+4.125rem))] sm:scroll-mt-[var(--chat-toolbar-clear,calc(max(0.5rem,var(--chat-inset-top,env(safe-area-inset-top)))+3.625rem))]'

export function toolbarClearance(heightPx: number): string {
  return `${Math.ceil(heightPx) + TOOLBAR_BREATH_PX}px`
}
