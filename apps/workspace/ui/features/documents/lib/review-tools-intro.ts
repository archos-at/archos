export const TOOLS_INTRO_KEY = 'review.toolsIntroSeen'

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
