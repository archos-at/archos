export const AUTOMATION_TABS = ['tasks', 'skills'] as const
export type AutomationTab = (typeof AUTOMATION_TABS)[number]

const LEGACY_TAB_ALIASES: Record<string, AutomationTab> = {
  jobs: 'tasks',
  schedule: 'tasks',
}

export function parseAutomationTab(value: string | undefined): AutomationTab {
  const candidate = LEGACY_TAB_ALIASES[value ?? ''] ?? value
  return (AUTOMATION_TABS as readonly string[]).includes(candidate ?? '')
    ? (candidate as AutomationTab)
    : 'tasks'
}

export function tabForDeepLink(params: URLSearchParams): AutomationTab | null {
  if (params.has('task')) return 'tasks'
  if (params.has('schedule')) return 'tasks'
  if (params.has('skill')) return 'skills'
  return null
}
