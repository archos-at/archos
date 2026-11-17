import { z } from 'zod'
import { TASK_RUN_STATUSES } from '@/lib/tasks/task-vocabulary'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

export const RUN_PHASES = ['planning', 'researching', 'checking', 'writing', 'filed'] as const
export type RunPhase = (typeof RUN_PHASES)[number]

export const RUN_STATUSES = [
  'created',
  'running',
  'waiting',
  'done',
  'failed',
  'cancelled',
  'interrupted',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const TERMINAL_RUN_STATUSES = [
  'done',
  'failed',
  'cancelled',
  'interrupted',
] as const satisfies readonly RunStatus[]

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status)
}

export const RUN_LEDGER_LIFECYCLE = defineLifecycle<
  RunStatus,
  'start' | 'ask' | 'resume' | 'finish' | 'fail' | 'cancel' | 'salvage'
>({
  id: 'run-ledger',
  initial: 'created',
  states: {
    created: { on: { start: 'running', ask: 'waiting', finish: 'done', fail: 'failed', cancel: 'cancelled' } },
    running: {
      on: { ask: 'waiting', finish: 'done', fail: 'failed', cancel: 'cancelled', salvage: 'interrupted' },
    },
    waiting: { on: { resume: 'running', finish: 'done', fail: 'failed', cancel: 'cancelled' } },
    done: { on: { salvage: 'interrupted' } },
    failed: { type: 'final' },
    cancelled: { type: 'final' },
    interrupted: { type: 'final' },
  },
})

export const LEGACY_RUN_PHASE: Readonly<Record<string, RunPhase>> = {
  planen: 'planning',
  recherchieren: 'researching',
  pruefen: 'checking',
  schreiben: 'writing',
  abgelegt: 'filed',
}

export const LEGACY_RUN_STATUS: Readonly<Record<string, RunStatus>> = {
  angelegt: 'created',
  laeuft: 'running',
  wartet: 'waiting',
  fertig: 'done',
  fehlgeschlagen: 'failed',
  abgebrochen: 'cancelled',
  unterbrochen: 'interrupted',
}

const isLooseRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mapped = (value: unknown, table: Readonly<Record<string, string>>): unknown =>
  typeof value === 'string' && Object.hasOwn(table, value) ? table[value] : value

const mapPhaseOf = (entry: unknown): unknown =>
  isLooseRecord(entry) ? { ...entry, phase: mapped(entry.phase, LEGACY_RUN_PHASE) } : entry

export function modernizeRunLedger(raw: unknown): unknown {
  if (!isLooseRecord(raw)) return raw
  const out: Record<string, unknown> = { ...raw }
  if ('status' in out) out.status = mapped(out.status, LEGACY_RUN_STATUS)
  if (Array.isArray(out.phases)) out.phases = out.phases.map(mapPhaseOf)
  if (Array.isArray(out.steps)) out.steps = out.steps.map(mapPhaseOf)
  if (isLooseRecord(out.error) && Array.isArray(out.error.completedBefore)) {
    out.error = {
      ...out.error,
      completedBefore: out.error.completedBefore.map((phase) => mapped(phase, LEGACY_RUN_PHASE)),
    }
  }
  if ('grundlage' in out) {
    if (!('basis' in out)) out.basis = out.grundlage
    delete out.grundlage
  }
  return out
}

export const MAX_RUN_ID_CHARS = 64
export const MAX_STEPS = 50
export const MAX_STEP_ID_CHARS = 64
export const MAX_INTENT_CHARS = 160
export const MAX_DOCS_PER_STEP = 100
export const MAX_NAME_CHARS = 256
export const MAX_TITLE_CHARS = 256
export const MAX_SHELF_CHARS = 64
export const MAX_LOCUS_CHARS = 128
export const MAX_LOCI_PER_DOC = 20
export const MAX_OPEN_POINTS = 20
export const MAX_OPEN_POINT_CHARS = 200
export const MAX_FINDINGS_PER_STEP = 8
export const MAX_FINDING_CHARS = 200
export const MAX_ERROR_REASON_CHARS = 400
export const MAX_REFERENCE_ID_CHARS = 128
export const MAX_BASIS_DOCS = 20
export const MAX_RUN_TITLE_CHARS = 200
export const MAX_TIMESTAMP_CHARS = 40

const instantSchema = z.string().datetime({ offset: true })

export const runLedgerDocSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME_CHARS),
    title: z.string().trim().min(1).max(MAX_TITLE_CHARS).optional(),
    shelf: z.string().trim().min(1).max(MAX_SHELF_CHARS).optional(),
    loci: z.array(z.string().trim().min(1).max(MAX_LOCUS_CHARS)).max(MAX_LOCI_PER_DOC),
    repeat: z.boolean().optional(),
  })
  .strict()

export type RunLedgerDoc = z.infer<typeof runLedgerDocSchema>

export const runStepSchema = z
  .object({
    id: z.string().trim().min(1).max(MAX_STEP_ID_CHARS),
    phase: z.enum(RUN_PHASES),
    intent: z.string().trim().min(1).max(MAX_INTENT_CHARS),
    startedAt: instantSchema,
    docs: z.array(runLedgerDocSchema).max(MAX_DOCS_PER_STEP),
    openPoints: z
      .array(z.string().trim().min(1).max(MAX_OPEN_POINT_CHARS))
      .max(MAX_OPEN_POINTS)
      .optional(),
    findings: z
      .array(z.string().trim().min(1).max(MAX_FINDING_CHARS))
      .max(MAX_FINDINGS_PER_STEP)
      .optional(),
  })
  .strict()

export type RunStep = z.infer<typeof runStepSchema>

export const runPhaseEntrySchema = z
  .object({
    phase: z.enum(RUN_PHASES),
    startedAt: instantSchema,
    endedAt: instantSchema.optional(),
  })
  .strict()

export type RunPhaseEntry = z.infer<typeof runPhaseEntrySchema>

export const runResultSchema = z
  .object({
    fileId: z.string().trim().min(1).max(MAX_REFERENCE_ID_CHARS).optional(),
    reportMessageId: z.string().trim().min(1).max(MAX_REFERENCE_ID_CHARS).optional(),
    filedAt: instantSchema,
  })
  .strict()

export type RunResult = z.infer<typeof runResultSchema>

export const runErrorSchema = z
  .object({
    reason: z.string().trim().min(1).max(MAX_ERROR_REASON_CHARS),
    completedBefore: z.array(z.enum(RUN_PHASES)).max(RUN_PHASES.length),
  })
  .strict()

export type RunError = z.infer<typeof runErrorSchema>

export const runLedgerSchema = z
  .object({
    runId: z.string().trim().min(1).max(MAX_RUN_ID_CHARS),
    status: z.enum(RUN_STATUSES),
    phases: z.array(runPhaseEntrySchema).max(RUN_PHASES.length),
    steps: z.array(runStepSchema).max(MAX_STEPS),
    result: runResultSchema.optional(),
    error: runErrorSchema.optional(),
    basis: z.array(runLedgerDocSchema).max(MAX_BASIS_DOCS).optional(),
    startedAt: instantSchema,
    updatedAt: instantSchema,
    finishedAt: instantSchema.optional(),
  })
  .strict()

export type RunLedger = z.infer<typeof runLedgerSchema>

export const runLedgerAppendRequestSchema = z
  .object({
    op: z.literal('append'),
    steps: z.array(runStepSchema).max(MAX_STEPS).optional(),
    phases: z.array(runPhaseEntrySchema).max(RUN_PHASES.length).optional(),
    status: z.enum(RUN_STATUSES).optional(),
    basis: z.array(runLedgerDocSchema).max(MAX_BASIS_DOCS).optional(),
  })
  .strict()

export const runLedgerFinishRequestSchema = z
  .object({
    op: z.literal('finish'),
    result: runResultSchema.optional(),
    error: z
      .object({ reason: z.string().trim().min(1).max(MAX_ERROR_REASON_CHARS) })
      .strict()
      .optional(),
  })
  .strict()

export const runLedgerRequestSchema = z.discriminatedUnion('op', [
  runLedgerAppendRequestSchema,
  runLedgerFinishRequestSchema,
])

export type RunLedgerAppendRequest = z.infer<typeof runLedgerAppendRequestSchema>
export type RunLedgerFinishRequest = z.infer<typeof runLedgerFinishRequestSchema>
export type RunLedgerRequest = z.infer<typeof runLedgerRequestSchema>

export const runLedgerResponseSchema = z
  .object({ runId: z.string().min(1).max(MAX_RUN_ID_CHARS), ledger: runLedgerSchema })
  .strict()

export type RunLedgerResponse = z.infer<typeof runLedgerResponseSchema>

export const runReportSchema = z
  .object({
    text: z.string().nullable(),
    truncated: z.boolean(),
    filedDocumentId: z.string().nullable(),
  })
  .strict()

export const runViewSchema = z
  .object({
    runId: z.string().min(1).max(MAX_RUN_ID_CHARS),
    taskId: z.string().nullable(),
    conversationId: z.string().nullable(),
    messageId: z.string().nullable(),
    status: z.enum(TASK_RUN_STATUSES),
    ledger: runLedgerSchema.nullable(),
    report: runReportSchema.optional(),
    backendJobId: z.string().nullable().optional(),
  })
  .strict()

export type RunView = z.infer<typeof runViewSchema>

export const RUN_LEDGER_WIRE_SCHEMAS = {
  runLedger: runLedgerSchema,
  runLedgerRequest: runLedgerRequestSchema,
  runLedgerResponse: runLedgerResponseSchema,
  runView: runViewSchema,
} as const
