import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'

export type DecisionOrigin = 'person' | 'documents' | 'agent'

export function isConfirmedMemory(item: Pick<ProjectMemoryItem, 'pinned' | 'verification' | 'provenanceType'>): boolean {
  return item.pinned || item.verification === 'user_confirmed' || item.provenanceType === 'user'
}

export function decisionOriginOf(found: { confirmed: boolean; verification: ProjectMemoryItem['verification'] }): DecisionOrigin {
  if (found.confirmed) return 'person'
  return found.verification === 'source_grounded' ? 'documents' : 'agent'
}

export function memoryOriginOf(item: Pick<ProjectMemoryItem, 'pinned' | 'verification' | 'provenanceType'>): DecisionOrigin {
  return decisionOriginOf({ confirmed: isConfirmedMemory(item), verification: item.verification })
}
