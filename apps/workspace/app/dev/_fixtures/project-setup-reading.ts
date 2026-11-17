import type { IntakeView, ReadingProgress } from '@/lib/project-intake/types'
import {
  FIXTURE_LOCATION,
  INTAKE_COMPLETED,
  INTAKE_FAILED,
  INTAKE_READING,
  INTAKE_READY,
  INTAKE_WAITING,
} from './project-intake'

const SITE_FROM_GEOCODER: ReadingProgress['site'] = {
  federalState: 'Wien',
  municipality: 'Wien',
  address: FIXTURE_LOCATION.label,
  source: 'geocoder',
  confirmed: true,
}

const progress = (documentsOpened: number, documentsTotal: number, site = SITE_FROM_GEOCODER): ReadingProgress => ({
  documentsOpened,
  documentsTotal,
  site,
})

export const READING_WAITING: IntakeView = { ...INTAKE_WAITING, readingProgress: progress(0, 0) }

export const READING_QUEUED: IntakeView = {
  ...INTAKE_WAITING,
  counts: { ...INTAKE_WAITING.counts, unreadDocuments: 23 },
  readingProgress: progress(0, 23),
}

export const READING_RUNNING: IntakeView = {
  ...INTAKE_READING,
  counts: { documentsRead: 0, unreadDocuments: 23, suggested: 6, contradictions: 0, decisiveOpen: 4 },
  readingProgress: progress(9, 23),
}

export const READING_SITE_FROM_DOCUMENTS: IntakeView = {
  ...READING_RUNNING,
  location: null,
  readingProgress: progress(14, 23, {
    federalState: 'Niederösterreich',
    municipality: null,
    address: 'Hauptplatz 4, 3100 St. Pölten',
    source: 'document',
    confirmed: false,
  }),
}

export const READING_SITE_SEARCHING: IntakeView = {
  ...READING_RUNNING,
  location: null,
  readingProgress: progress(3, 23, { federalState: null, municipality: null, address: null, source: null, confirmed: false }),
}

export const READING_READY: IntakeView = {
  ...INTAKE_READY,
  counts: { ...INTAKE_READY.counts, contradictions: 6, decisiveOpen: 9 },
  readingProgress: progress(23, 23),
}

export const READING_READY_WITH_REST: IntakeView = {
  ...READING_READY,
  counts: { ...READING_READY.counts, documentsRead: 21, unreadDocuments: 2 },
  readingProgress: progress(21, 23),
}

export const READING_FAILED: IntakeView = {
  ...INTAKE_FAILED,
  counts: { documentsRead: 0, unreadDocuments: 23, suggested: 6, contradictions: 0, decisiveOpen: 4 },
  summary: null,
  readingProgress: progress(9, 23),
}

export const READING_COMPLETED: IntakeView = {
  ...INTAKE_COMPLETED,
  summary: INTAKE_READY.summary,
  readingProgress: progress(23, 23),
}

export const READING_FIXTURES = {
  waiting: READING_WAITING,
  queued: READING_QUEUED,
  reading: READING_RUNNING,
  siteFromDocuments: READING_SITE_FROM_DOCUMENTS,
  siteSearching: READING_SITE_SEARCHING,
  ready: READING_READY,
  readyWithRest: READING_READY_WITH_REST,
  failed: READING_FAILED,
  completed: READING_COMPLETED,
} as const satisfies Record<string, IntakeView>
export type ReadingFixtureName = keyof typeof READING_FIXTURES
