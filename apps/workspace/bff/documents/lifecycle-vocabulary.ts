export const DOCUMENT_VERSION_STATES = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'published',
  'superseded',
  'rejected',
] as const
export type DocumentVersionState = (typeof DOCUMENT_VERSION_STATES)[number]

export const OPEN_DOCUMENT_VERSION_STATES = [
  'draft',
  'in_review',
  'changes_requested',
] as const satisfies readonly DocumentVersionState[]

export const DOCUMENT_SUBMIT_ACTORS = ['human', 'agent'] as const
export type DocumentSubmitActor = (typeof DOCUMENT_SUBMIT_ACTORS)[number]

export const DOCUMENT_VERSION_ORIGINS = ['upload', 'draft'] as const
export type DocumentVersionOrigin = (typeof DOCUMENT_VERSION_ORIGINS)[number]

export const DOCUMENT_LIFECYCLES = ['active', 'archived'] as const
export type DocumentLifecycle = (typeof DOCUMENT_LIFECYCLES)[number]
