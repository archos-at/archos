import { z } from 'zod'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import { MAX_JUDGED_DOCUMENTS } from './types'

export const ROOT_SORT_CHUNK = MAX_JUDGED_DOCUMENTS / 2
export const CHUNKS_PER_SLICE = 6
export const MAX_ROOT_SORT_DOCUMENTS = 5000
export const MAX_MOVES_PER_SLICE = 100
export const SURE_CONFIDENCE = 0.8

export type RootSortShelf = { kind: 'project'; projectId: string } | { kind: 'office_shelf' }

export const rootSortFolderSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  path: z.string(),
})
export type RootSortFolder = z.infer<typeof rootSortFolderSchema>

export const rootSortDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type RootSortDocument = z.infer<typeof rootSortDocumentSchema>

export const rootSortScanSchema = z.object({
  folders: z.array(rootSortFolderSchema),
  documents: z.array(rootSortDocumentSchema),
  unreadable: z.number().int().nonnegative(),
  truncated: z.boolean(),
})
export type RootSortScan = z.infer<typeof rootSortScanSchema>

export const rootSortPlacementSchema = z.object({
  documentId: z.string(),
  folderId: z.string().nullable(),
  newFolderPath: z.string().nullable(),
  reason: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
})
export type RootSortPlacement = z.infer<typeof rootSortPlacementSchema>

export interface RootSortPlan {
  placements: RootSortPlacement[]
  error: string | null
  traceId: string | null
}

export const MAX_NEW_FOLDER_DOCUMENTS = 1000
export const MAX_NEW_FOLDERS = 12

export const newFolderProposalSchema = z.object({
  path: z.string(),
  description: z.string().nullable(),
  documentIds: z.array(z.string()),
  confidences: z.record(z.string(), z.number().min(0).max(1)),
})
export type NewFolderProposal = z.infer<typeof newFolderProposalSchema>

export interface NewFolders {
  proposals: NewFolderProposal[]
  error: string | null
  traceId: string | null
}

export type { ApplyRootSortRequest, KeptMove } from './root-sort-wire'

export const ROOT_SORT_RUN_STATUSES = [
  'judging',
  'grouping',
  'ready',
  'applying',
  'applied',
  'undoing',
  'undone',
  'cancelled',
  'failed',
] as const
export type RootSortRunStatus = (typeof ROOT_SORT_RUN_STATUSES)[number]

export const ROOT_SORT_LIFECYCLE = defineLifecycle<
  RootSortRunStatus,
  'advance' | 'apply' | 'undo' | 'cancel' | 'withdraw' | 'fail'
>({
  id: 'root-sort-run',
  initial: 'judging',
  states: {
    judging: { on: { advance: 'grouping', cancel: 'cancelled', fail: 'failed' } },
    grouping: { on: { advance: 'ready', cancel: 'cancelled', fail: 'failed' } },
    ready: { on: { apply: 'applying', cancel: 'cancelled' } },
    applying: { on: { advance: 'applied', withdraw: 'ready', fail: 'failed' } },
    applied: { on: { undo: 'undoing' } },
    undoing: { on: { advance: 'undone', withdraw: 'applied', fail: 'failed' } },
    undone: { type: 'final' },
    cancelled: { type: 'final' },
    failed: { on: { undo: 'undoing' } },
  },
})

export const ROOT_SORT_WORKING_STATUSES: readonly RootSortRunStatus[] = ['judging', 'grouping', 'applying', 'undoing']

export const rootSortRunSchema = z.object({
  id: z.string(),
  status: z.enum(ROOT_SORT_RUN_STATUSES),
  progress: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  waiting: z.boolean(),
  recent: z.array(z.object({ name: z.string(), folderPath: z.string() })),
  unreadable: z.number().int().nonnegative(),
  truncated: z.boolean(),
  review: z
    .object({
      folders: z.array(rootSortFolderSchema),
      documents: z.array(rootSortDocumentSchema),
      placements: z.array(rootSortPlacementSchema),
      newFolders: z.array(newFolderProposalSchema),
      failedDocumentIds: z.array(z.string()),
    })
    .nullable(),
  moved: z.number().int().nonnegative(),
  moveFailures: z.array(z.object({ documentId: z.string(), error: z.string() })),
  undoFailures: z.array(z.object({ documentId: z.string(), error: z.string() })),
  error: z.string().nullable(),
  groupingError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type RootSortRunView = z.infer<typeof rootSortRunSchema>

export const rootSortSummarySchema = z.object({
  files: z.number().int().nonnegative(),
  folders: z.number().int().nonnegative(),
  unreadable: z.number().int().nonnegative(),
  truncated: z.boolean(),
  run: rootSortRunSchema.nullable(),
})
export type RootSortSummary = z.infer<typeof rootSortSummarySchema>

export type PlacementCertainty = 'sure' | 'unsure'

export function certaintyOf(confidence: number | null): PlacementCertainty {
  return confidence !== null && confidence >= SURE_CONFIDENCE ? 'sure' : 'unsure'
}
