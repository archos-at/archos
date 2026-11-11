/**
 * Whether this browser has seen the review's tools explained: the first review
 * it opens spells every tool out with its key, and later ones show the glyphs.
 * Kept in `localStorage`; a browser that cannot be asked counts as having seen it.
 */

/** Where this browser keeps that it has seen the tools explained: the first review opens with them spelled out. */
export const TOOLS_INTRO_KEY = 'review.toolsIntroSeen'

/** Whether the tools were explained here before. Storage that cannot be read counts as seen: no intro on every open. */
export function toolsIntroSeen(): boolean {
  try {
    return window.localStorage.getItem(TOOLS_INTRO_KEY) === '1'
  } catch {
    return true
  }
}

export function rememberToolsIntro(): void {
  try {
    window.localStorage.setItem(TOOLS_INTRO_KEY, '1')
  } catch {
    // A private window: the intro shows again next time, which is harmless.
  }
}
