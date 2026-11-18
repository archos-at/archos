export const PROJECT_SETTINGS_SECTION_KEYS = [
  'overview',
  'members',
  'memory',
  'usage',
  'documents',
  'references',
] as const

export type ProjectSettingsSectionKey = (typeof PROJECT_SETTINGS_SECTION_KEYS)[number]

export interface ProjectSettingsVisibility {
  manageMembers: boolean
  manageBudget: boolean
}

export function visibleSettingsSections(
  access: ProjectSettingsVisibility
): ProjectSettingsSectionKey[] {
  return PROJECT_SETTINGS_SECTION_KEYS.filter((key) => {
    if (key === 'members') return access.manageMembers
    if (key === 'usage') return access.manageBudget
    return true
  })
}

export function settingsSectionHref(projectId: string, key: ProjectSettingsSectionKey): string {
  const base = `/app/projects/${encodeURIComponent(projectId)}/settings`
  return key === 'overview' ? base : `${base}/${key}`
}
