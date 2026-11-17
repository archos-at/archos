import { canonicalSkillName, legacyNamesOf } from '@/lib/skills/legacy-names'

export interface SlashCommandQuery {
  query: string
  start: number
  end: number
}

export interface SlashInvocation {
  skillName: string
  token: string
  argument: string
}

const MAX_QUERY_LENGTH = 64

export function findSlashCommandQuery(text: string, caret: number): SlashCommandQuery | null {
  const start = text.search(/\S/)
  if (start === -1 || text[start] !== '/') return null

  const position = Math.max(0, Math.min(caret, text.length))
  if (position <= start) return null

  const fragment = text.slice(start + 1, position)
  if (/\s/.test(fragment)) return null
  if (fragment.length > MAX_QUERY_LENGTH) return null

  return { query: fragment, start, end: position }
}

export function insertSlashCommand(
  text: string,
  range: SlashCommandQuery,
  name: string,
): { text: string; caret: number } {
  const rest = text.slice(range.end)
  const token = `/${name}${rest.startsWith(' ') ? '' : ' '}`
  return {
    text: `${text.slice(0, range.start)}${token}${rest}`,
    caret: range.start + token.length,
  }
}

export function resolveSlashInvocation(
  text: string,
  knownNames: readonly string[],
): SlashInvocation | null {
  const start = text.search(/\S/)
  if (start === -1 || text[start] !== '/') return null

  const afterSlash = text.slice(start + 1)
  const boundary = afterSlash.search(/\s/)
  const token = boundary === -1 ? afterSlash : afterSlash.slice(0, boundary)
  const skillName = canonicalSkillName(token)
  if (!token || !(knownNames.includes(token) || knownNames.includes(skillName))) return null

  return {
    skillName: knownNames.includes(token) ? token : skillName,
    token,
    argument: boundary === -1 ? '' : afterSlash.slice(boundary).trim(),
  }
}

export function filterSlashCommands<T extends { name: string; description: string }>(
  skills: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...skills]

  const ranked: Array<{ skill: T; rank: number }> = []
  for (const skill of skills) {
    const name = skill.name.toLowerCase()
    const typedTheOldName = legacyNamesOf(skill.name).some((legacy) => legacy.startsWith(needle))
    if (name.startsWith(needle)) ranked.push({ skill, rank: 0 })
    else if (name.includes(needle) || typedTheOldName) ranked.push({ skill, rank: 1 })
    else if (skill.description.toLowerCase().includes(needle)) ranked.push({ skill, rank: 2 })
  }
  return ranked.sort((left, right) => left.rank - right.rank).map((entry) => entry.skill)
}
