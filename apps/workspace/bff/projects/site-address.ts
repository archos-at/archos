import type { Project } from '@/lib/db/schema/projects'

export function projectFactText(project: Pick<Project, 'profile'>, key: string): string | null {
  const value = project.profile?.facts?.[key]?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function projectAssumptionText(project: Pick<Project, 'profile'>, key: string): string | null {
  const value = project.profile?.assumptions?.[key]?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function projectCity(project: Pick<Project, 'profile'>): string | null {
  const address = projectSiteAddress(project)
  const place = address?.split(',').at(-1)?.replace(/^\s*(?:[A-Z]{1,2}-)?\d{4,5}\s+/, '').trim()
  return place || null
}

export function projectSiteAddress(project: Pick<Project, 'profile'>): string | null {
  return (
    projectFactText(project, 'site_address') ??
    projectFactText(project, 'standort_adresse') ??
    projectAssumptionText(project, 'site_address')
  )
}
