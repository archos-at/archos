import type { FingerprintFact } from '@/lib/cross-project/fingerprint'
import type { PermitRecordKind, PermitRequirementKind } from '@/lib/db/schema/permit-records'
import type { ProjectMemoryKind } from '@/lib/db/schema/project-memory'

export const SIMILAR_PROJECTS_MAX = 12
export const SIMILAR_DECISIONS_MAX = 5
export const SIMILAR_DECISION_SOURCES_MAX = 3
export const SIMILAR_PERMITS_MAX = 5
export const SIMILAR_PERMIT_REQUIREMENTS_MAX = 4
export const SIMILAR_PERMIT_RECORDS_READ = 20

export type ReferenceOrigin = 'person' | 'documents' | 'agent'

export interface ReferenceFact<T> {
  value: T
  confirmed: boolean
}

export interface ReferenceDecision {
  id: string
  kind: Extract<ProjectMemoryKind, 'decision' | 'constraint'>
  content: string
  origin: ReferenceOrigin
  sources: { fileName: string; page: string | null }[]
}

export interface ReferencePermitRequirement {
  kind: PermitRequirementKind
  content: string
}

export interface ReferencePermit {
  id: string
  fileName: string
  kind: PermitRecordKind
  authority: string | null
  issuedOn: string | null
  requirements: ReferencePermitRequirement[]
}

export interface ReferencePeriod {
  start: string
  end: string | null
}

export interface SimilarProject {
  id: string
  name: string
  period: ReferencePeriod
  federal_state: ReferenceFact<string> | null
  oibEdition: ReferenceFact<string> | null
  alike: boolean
  sharedTraits: ReferenceFact<string>[]
  decisions: ReferenceDecision[]
  permits: ReferencePermit[]
  counts: { decisions: number; permits: number }
}

export interface ReferenceBasis {
  facts: FingerprintFact[]
  missing: number
  editable: boolean
}

export interface SimilarProjectsPage {
  basis: ReferenceBasis
  projects: SimilarProject[]
  more: number
}
