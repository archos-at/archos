import type { Project } from '@/lib/db/schema/projects'

export function projectFactText(project: Pick<Project, 'profile'>, key: string): string | null {
  const value = project.profile?.facts?.[key]?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function projectAssumptionText(project: Pick<Project, 'profile'>, key: string): string | null {
  const value = project.profile?.assumptions?.[key]?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function projectSiteAddress(project: Pick<Project, 'profile'>): string | null {
  return (
    projectFactText(project, 'site_address') ??
    projectFactText(project, 'standort_adresse') ??
    projectAssumptionText(project, 'site_address')
  )
}
