import type { ProjectPersonView } from '@/lib/projects/project-record-types'
import type { ProjectMemberRoleSlug, ProjectRoster, RosterMember } from '@/lib/projects/participants-client'

export interface ParticipantRow {
  key: string
  person: ProjectPersonView
  role: ProjectMemberRoleSlug | null
  membership: RosterMember | null
  you: boolean
}

export const participantKey = (person: ProjectPersonView): string => person.id ?? person.userId ?? person.name

const ORDER: Record<ProjectPersonView['kind'], number> = { member: 0, added: 1, former: 2 }

export function participantRows(people: readonly ProjectPersonView[], roster: ProjectRoster | null): ParticipantRow[] {
  const byUser = new Map((roster?.members ?? []).map((member) => [member.userId, member]))
  return people
    .map((person, index) => ({ person, index }))
    .sort((a, b) => ORDER[a.person.kind] - ORDER[b.person.kind] || a.index - b.index)
    .map(({ person }) => {
      const member = person.kind === 'member' && person.userId ? (byUser.get(person.userId) ?? null) : null
      const you = Boolean(person.userId && roster?.viewerUserId === person.userId)
      return {
        key: participantKey(person),
        person,
        role: member?.role ?? null,
        membership: member && !you ? member : null,
        you,
      }
    })
}

export function colleagueCandidates(roster: ProjectRoster | null): RosterMember[] {
  if (!roster) return []
  return roster.members
    .filter((member) => member.role === null)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export const DEFAULT_COLLEAGUE_ROLE: ProjectMemberRoleSlug = 'project-editor'
