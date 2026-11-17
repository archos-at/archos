/**
 * Where a project is: the profile fact `site_address`, the one place the
 * Standort is kept and edited (the intake wizard writes it, the Steckbrief
 * shows it). An address typed at creation and confirmed by no register is the
 * assumption `site_address` until someone confirms it, and is read from there. Pure and type-only, so the project list's lean summary and the
 * project tiles on the client read it through one rule.
 */

import type { Project } from '@/lib/db/schema/projects'

/** The trimmed string value of one profile fact, or null when it is absent, blank or not a string. */
export function projectFactText(project: Pick<Project, 'profile'>, key: string): string | null {
  const value = project.profile?.facts?.[key]?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The trimmed string value of one unconfirmed profile assumption, or null. */
function projectAssumptionText(project: Pick<Project, 'profile'>, key: string): string | null {
  const value = project.profile?.assumptions?.[key]?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The project's site address, confirmed or typed, or null when nobody has given one. */
export function projectSiteAddress(project: Pick<Project, 'profile'>): string | null {
  // `standort_adresse`: the key an older pod still writes during a rolling deploy (migration 0159).
  return (
    projectFactText(project, 'site_address') ??
    projectFactText(project, 'standort_adresse') ??
    projectAssumptionText(project, 'site_address')
  )
}
