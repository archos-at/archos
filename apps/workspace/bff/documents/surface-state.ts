import type { Translator } from '@/i18n/translate'
import {
  documentStatusFacts,
  type DocumentReadFamily,
  type DocumentStatusVariant,
  type KnownDocumentStatus,
} from './document-status'

export type SurfaceState =
  | 'citable'
  | 'uploading'
  | 'reading'
  | 'held'
  | 'unreadable'
  | 'stored'
  | 'cancelled'
  | 'unknown'

export const SURFACE_STATES: readonly SurfaceState[] = [
  'citable',
  'uploading',
  'reading',
  'held',
  'unreadable',
  'stored',
  'cancelled',
  'unknown',
]

const STATE_BY_VARIANT: Record<DocumentStatusVariant, SurfaceState> = {
  success: 'citable',
  info: 'reading',
  warning: 'held',
  destructive: 'unreadable',
  secondary: 'stored',
}

const STATE_BY_STATUS: ReadonlyMap<string, SurfaceState> = new Map<KnownDocumentStatus, SurfaceState>([
  ['uploading', 'uploading'],
  ['cancelled', 'cancelled'],
])

export function surfaceStateOf(status: string | null | undefined): SurfaceState {
  const facts = documentStatusFacts(status)
  if (!facts) return 'unknown'
  return STATE_BY_STATUS.get((status ?? '').toLowerCase()) ?? STATE_BY_VARIANT[facts.variant]
}

const VARIANT_BY_STATE: Record<SurfaceState, DocumentStatusVariant> = {
  citable: 'success',
  uploading: 'info',
  reading: 'info',
  held: 'warning',
  unreadable: 'destructive',
  stored: 'secondary',
  cancelled: 'secondary',
  unknown: 'secondary',
}

export function surfaceStateVariant(state: SurfaceState): DocumentStatusVariant {
  return VARIANT_BY_STATE[state]
}

export const SURFACE_STATE_LABEL_KEYS: Record<SurfaceState, string> = {
  citable: 'status.ready',
  uploading: 'status.uploading',
  reading: 'status.processing',
  held: 'status.quarantined',
  unreadable: 'status.failed',
  stored: 'status.stored',
  cancelled: 'status.cancelled',
  unknown: 'status.unknown',
}

export function surfaceStateLabel(state: SurfaceState, t: Translator): string {
  return t(SURFACE_STATE_LABEL_KEYS[state])
}

const FAMILY_BY_STATE: Record<SurfaceState, DocumentReadFamily> = {
  citable: 'readable',
  uploading: 'reading',
  reading: 'reading',
  held: 'held',
  unreadable: 'failed',
  stored: 'unindexed',
  cancelled: 'unindexed',
  unknown: 'reading',
}

export function readFamilyOfState(state: SurfaceState): DocumentReadFamily {
  return FAMILY_BY_STATE[state]
}

const STATE_BY_FAMILY: Record<DocumentReadFamily, SurfaceState> = {
  readable: 'citable',
  reading: 'reading',
  held: 'held',
  failed: 'unreadable',
  unindexed: 'stored',
}

export function stateOfReadFamily(family: DocumentReadFamily): SurfaceState {
  return STATE_BY_FAMILY[family]
}
