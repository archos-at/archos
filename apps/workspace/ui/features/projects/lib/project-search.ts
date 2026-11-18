import type { Project } from '@/lib/db/schema/projects'

export type SearchableProject = Pick<Project, 'name'> & Partial<Pick<Project, 'profile' | 'profileDisplay'>>

const MIN_FACT_TEXT = 3

function factTexts(project: SearchableProject): string[] {
  const facts = project.profile?.facts
  if (!facts) return []
  const texts: string[] = []
  for (const fact of Object.values(facts)) {
    const value = fact?.value
    if (typeof value === 'string') texts.push(value)
    else if (Array.isArray(value)) texts.push(...value)
  }
  return texts.filter((text) => text.trim().length >= MIN_FACT_TEXT)
}

export function projectSearchText(project: SearchableProject): string {
  const display = project.profileDisplay
  return [
    project.name,
    display?.summary,
    ...(display?.keyFacts ?? []).map((fact) => fact.value),
    ...factTexts(project),
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n')
    .toLowerCase()
}

export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

export function projectMatchesQuery(project: SearchableProject, query: string): boolean {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return true
  const haystack = projectSearchText(project)
  return tokens.every((token) => haystack.includes(token))
}
