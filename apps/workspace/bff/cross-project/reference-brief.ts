import 'server-only'
import type { Project } from '@/lib/db/schema/projects'
import { isProjectClosed } from '@/lib/projects/project-status'
import { findProjectInOrg, listProjectsInOrg } from '@/lib/projects/repository'
import { fingerprintLabels, sharedTraitLabel } from './fingerprint'
import { rankBySimilarity, sharedTraits, similarityFacts, type SimilarityFacts } from './similarity'

export const REFERENCE_BRIEF_MAX = 12

const SUMMARY_CHARS = 160

function year(day: string | null): string | null {
  return day ? day.slice(0, 4) : null
}

function periodLabel(project: Pick<Project, 'startedOn' | 'endedOn' | 'closedAt'>): string | null {
  const start = year(project.startedOn)
  const end = year(project.endedOn) ?? (project.closedAt ? String(new Date(project.closedAt).getUTCFullYear()) : null)
  if (start && end) return start === end ? start : `${start}–${end}`
  return end ?? (start ? `${start}–` : null)
}

function summaryOf(project: Pick<Project, 'profileDisplay'>): string | null {
  const summary = project.profileDisplay?.summary?.replace(/\s+/g, ' ').trim()
  if (!summary) return null
  return summary.length > SUMMARY_CHARS ? `${summary.slice(0, SUMMARY_CHARS - 1).trimEnd()}…` : summary
}

function line(project: Project, current: SimilarityFacts | null): string {
  const facts = similarityFacts(project.profile)
  const head = [periodLabel(project), ...fingerprintLabels(project.profile)].filter(Boolean).join(', ')
  const shared = current ? sharedTraits(current, facts) : []
  const summary = summaryOf(project)
  return [
    `- ${project.name} (id ${project.id})${head ? `: ${head}` : ''}`,
    shared.length > 0 ? ` · gemeinsam: ${shared.map(sharedTraitLabel).join(', ')}` : '',
    summary ? ` · ${summary}` : '',
  ].join('')
}

export function renderReferenceBrief(current: Project | null, projects: readonly Project[]): string | null {
  const closed = projects.filter((project) => isProjectClosed(project) && project.id !== current?.id)
  if (closed.length === 0) return null
  const ranked = rankBySimilarity(current?.profile ?? null, closed)
  const listed = ranked.slice(0, REFERENCE_BRIEF_MAX)
  const facts = current ? similarityFacts(current.profile) : null
  const lines = listed.map((project) => line(project, facts))
  const more = closed.length - listed.length
  if (more > 0) lines.push(`- … und ${more} weitere abgeschlossene Projekte, über \`project_lookup\` auffindbar.`)
  return lines.join('\n')
}

export async function loadReferenceBrief(organizationId: string, projectId: string | null): Promise<string | null> {
  const [projects, current] = await Promise.all([
    listProjectsInOrg(organizationId, { order: 'newest' }),
    projectId ? findProjectInOrg(projectId, organizationId) : Promise.resolve(null),
  ])
  return renderReferenceBrief(current, projects)
}
