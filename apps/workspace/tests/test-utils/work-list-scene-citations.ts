import type { CitationSource } from '@/features/chat/types'
import { CONCEPT, DESCRIPTION, OIB_2, PLAN, SPEC } from './work-list-scene-documents'

const citation = (
  id: string,
  number: number,
  fileName: string,
  kind: 'building_law' | 'project',
  locus: { page?: number; clause?: string }
): CitationSource => ({
  id,
  content: `[KB] ${fileName}`,
  citationKey: `${fileName}${locus.page ? `, p.${locus.page}` : ''}`,
  fileName,
  collection: kind === 'building_law' ? 'oib_knowledge' : 'project',
  origin: 'kb',
  timestamp: new Date('2026-10-22T10:00:05Z'),
  kind,
  ...(kind === 'building_law'
    ? { lane: 'building_law_oib', laneLabel: 'OIB-Richtlinie' }
    : { lane: 'project' }),
  ...(locus.page ? { page: locus.page } : {}),
  ...(locus.clause ? { clause: locus.clause } : {}),
  number,
  isCited: true,
})

export const mockupCitations = (): CitationSource[] => [
  citation('c1', 1, OIB_2, 'building_law', { clause: '3.1.1' }),
  citation('c2', 2, PLAN, 'project', { page: 2 }),
  citation('c3', 3, CONCEPT, 'project', { page: 7 }),
]

export const failedCallCitations = (): CitationSource[] => [
  citation('f1', 1, CONCEPT, 'project', { page: 9 }),
  citation('f2', 2, DESCRIPTION, 'project', { page: 4 }),
]

export const singleReadCitations = (): CitationSource[] => [
  citation('s1', 1, CONCEPT, 'project', { page: 7 }),
]

export const filesystemCitations = (): CitationSource[] => [
  citation('fs1', 1, SPEC, 'project', { page: 4 }),
  citation('fs2', 2, CONCEPT, 'project', { page: 3 }),
]
