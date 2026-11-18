import type { AuthorizedSession } from '@/lib/auth/types'
import type { Project } from '@/lib/db/schema/projects'
import { crossProjectSearchRequestSchema } from './types'

const ORG = 'org_1'
export const OWNER = 'user_owner'
const session = { userId: OWNER, organizationId: ORG, role: 'member', permissions: [] } as unknown as AuthorizedSession

export function project(index: number, extra: Partial<Project> = {}): Project {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    organizationId: ORG,
    name: `Projekt ${index}`,
    createdBy: OWNER,
    collectionName: `proj_${index}`,
    workosResourceId: null,
    profile: { facts: {}, goals: {}, unknowns: [], assumptions: {} },
    profileVersion: 1,
    profilePromptView: null,
    profileDisplay: null,
    profileUpdatedAt: null,
    status: 'active',
    pausedAt: null,
    closedAt: null,
    closedBy: null,
    closedOutcome: null,
    startedOn: null,
    endedOn: null,
    deletedAt: null,
    createdAt: new Date(`2026-0${(index % 9) + 1}-15T10:00:00Z`),
    ...extra,
  }
}

export function hit(id: string, score: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    filename: `${id}.pdf`,
    displayName: null,
    collectionName: 'proj_1',
    createdAt: new Date('2026-05-01T08:00:00Z'),
    snippet: `Auszug aus ${id}`,
    page: 2,
    score,
    tags: ['Detail', 'Brandschutz'],
    ...extra,
  }
}

export const caller = (currentProjectId: string | null = null) => ({ session, conversationId: 's_conv', currentProjectId })
export const search = (body: Record<string, unknown>) => crossProjectSearchRequestSchema.parse({ query: 'Dachdetail Holzbau', ...body })
