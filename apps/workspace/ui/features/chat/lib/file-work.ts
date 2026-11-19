import type { DraftFileFormat } from '@/lib/conversations/draft-media'
import type { StepDetailValue, StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { formatOfFile } from './file-format'

export const FILE_RUN_SLOT = 'file-run:'

export const LONG_RUN_MS = 10_000

const OFFICE_SKILLS: Readonly<Record<string, readonly DraftFileFormat[] | 'any'>> = {
  'execute': 'any',
  'office-word': ['word'],
  'office-excel': ['excel', 'csv'],
  'office-powerpoint': ['powerpoint'],
  'office-pdf': ['pdf'],
  'office-pdf-charts': ['pdf', 'image'],
  'office-html-pdf': ['pdf', 'image'],
}

export type FileRunStatus = 'running' | 'ok' | 'error' | 'timeout' | 'refused' | 'unavailable'

export type FileNotKeptReason = 'too_large' | 'not_written'

const NOT_KEPT_REASONS: readonly FileNotKeptReason[] = ['too_large', 'not_written']

export interface FileRunInput {
  name: string
  documentId?: string
}

export interface FileRun {
  id: string
  index: number
  status: FileRunStatus
  attempt: number
  writes: string[]
  editing: string[]
  reads: string[]
  made: string[]
  changed: string[]
  failed: string[]
  failedReasons: FileNotKeptReason[]
  documents: FileRunInput[]
  result?: string
  elapsedMs?: number
}

export type FilePhaseKind = 'prepare' | 'make' | 'edit' | 'check' | 'calculate'

export type FilePhaseState = 'running' | 'done' | 'failed'

export interface FilePhase {
  kind: FilePhaseKind
  state: FilePhaseState
  attempts: number
  elapsedMs?: number
  reason?: FileNotKeptReason
}

export type FileOutcome = 'running' | 'made' | 'edited' | 'checked' | 'calculated' | 'failed'

export interface FileWork {
  key: string
  file?: string
  format?: DraftFileFormat
  outcome: FileOutcome
  failedKind?: FilePhaseKind
  failedReason?: FileNotKeptReason
  phases: FilePhase[]
  steps: number
  attempts: number
  elapsedMs?: number
  documents: FileRunInput[]
  result?: string
}

const RUN_STATUSES: readonly FileRunStatus[] = ['running', 'ok', 'error', 'timeout', 'refused', 'unavailable']

const strings = (value: StepDetailValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((item) => item.trim().length > 0) : []

const count = (value: StepDetailValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const reasonsOf = (value: StepDetailValue | undefined, length: number): FileNotKeptReason[] => {
  const given = Array.isArray(value) ? value : []
  return Array.from({ length }, (_, index) => {
    const reason = given[index]
    return (NOT_KEPT_REASONS as readonly string[]).includes(reason ?? '') ? (reason as FileNotKeptReason) : 'not_written'
  })
}

const runStatus = (step: StoredThinkingStep): FileRunStatus => {
  const status = step.detail?.status
  if (typeof status === 'string' && (RUN_STATUSES as readonly string[]).includes(status)) {
    return status as FileRunStatus
  }
  return step.isComplete ? 'ok' : 'running'
}

const inputsOf = (detail: StoredThinkingStep['detail']): FileRunInput[] => {
  const names = Array.isArray(detail?.documents) ? detail.documents : []
  const ids = Array.isArray(detail?.document_ids) ? detail.document_ids : []
  return names.flatMap((name, index) => {
    if (!name.trim()) return []
    const id = ids[index]?.trim()
    return [id ? { name, documentId: id } : { name }]
  })
}

export const isFileRun = (step: Pick<StoredThinkingStep, 'kind' | 'slot' | 'scope'>): boolean =>
  step.kind === 'status' && Boolean(step.slot?.startsWith(FILE_RUN_SLOT)) && step.scope !== 'deep'

export function fileRuns(steps: readonly StoredThinkingStep[]): FileRun[] {
  return steps.flatMap((step, index) => {
    if (!isFileRun(step)) return []
    const detail = step.detail
    const result = typeof detail?.result === 'string' && detail.result.trim() ? detail.result : undefined
    const elapsedMs = count(detail?.elapsed_ms)
    const failed = strings(detail?.failed)
    return [
      {
        id: step.id,
        index,
        status: runStatus(step),
        attempt: count(detail?.attempt) ?? 1,
        writes: strings(detail?.writes),
        editing: strings(detail?.editing),
        reads: strings(detail?.reads),
        made: strings(detail?.made),
        changed: strings(detail?.changed),
        failed,
        failedReasons: reasonsOf(detail?.failed_reasons, failed.length),
        documents: inputsOf(detail),
        ...(result ? { result } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      },
    ]
  })
}

const subjectsOf = (run: FileRun): string[] => {
  const kept = [...run.made, ...run.changed, ...run.failed]
  if (kept.length > 0) return kept
  if (run.writes.length > 0) return run.writes
  return run.reads
}

const kindOf = (run: FileRun, file: string): FilePhaseKind => {
  if (run.made.includes(file)) return 'make'
  if (run.changed.includes(file)) return 'edit'
  if (run.writes.includes(file)) return run.editing.includes(file) ? 'edit' : 'make'
  return 'check'
}

const stateOf = (status: FileRunStatus, live: boolean): FilePhaseState =>
  status === 'ok' ? 'done' : live ? 'running' : 'failed'

const notKeptReason = (run: FileRun, file: string): FileNotKeptReason | undefined => {
  const index = run.failed.indexOf(file)
  return index < 0 ? undefined : run.failedReasons[index]
}

interface Member {
  run: FileRun
  kind: FilePhaseKind
  reason?: FileNotKeptReason
}

const sumElapsed = (runs: readonly FileRun[]): number | undefined => {
  const known = runs.flatMap((run) => (run.elapsedMs === undefined ? [] : [run.elapsedMs]))
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) : undefined
}

const mergeInputs = (runs: readonly FileRun[]): FileRunInput[] => {
  const seen = new Map<string, FileRunInput>()
  for (const run of runs) {
    for (const input of run.documents) {
      const known = seen.get(input.name)
      if (!known || (!known.documentId && input.documentId)) seen.set(input.name, input)
    }
  }
  return [...seen.values()]
}

const phasesOf = (runs: readonly Member[], live: boolean): FilePhase[] => {
  const phases: Array<{ kind: FilePhaseKind; members: Member[] }> = []
  for (const member of runs) {
    const last = phases.at(-1)
    if (last && last.kind === member.kind) {
      last.members.push(member)
      continue
    }
    phases.push({ kind: member.kind, members: [member] })
  }
  return phases.map(({ members, kind }) => {
    const elapsedMs = sumElapsed(members.map((member) => member.run))
    const last = members.at(-1)!
    return {
      kind,
      state: last.reason ? 'failed' : stateOf(last.run.status, live),
      attempts: members.length,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      ...(last.reason ? { reason: last.reason } : {}),
    }
  })
}

const outcomeOf = (phases: readonly FilePhase[]): Pick<FileWork, 'outcome' | 'failedKind'> => {
  const last = phases.at(-1)
  if (!last) return { outcome: 'running' }
  if (last.state === 'failed') {
    return { outcome: 'failed', failedKind: last.kind, ...(last.reason ? { failedReason: last.reason } : {}) }
  }
  if (last.state === 'running') return { outcome: 'running' }
  const done = (kind: FilePhaseKind) => phases.some((phase) => phase.kind === kind && phase.state === 'done')
  if (done('calculate')) return { outcome: 'calculated' }
  if (done('make')) return { outcome: 'made' }
  if (done('edit')) return { outcome: 'edited' }
  return { outcome: 'checked' }
}

const prepares = (skill: string | undefined, format: DraftFileFormat): boolean => {
  const formats = skill ? OFFICE_SKILLS[skill] : undefined
  return formats === 'any' || Boolean(formats?.includes(format))
}

const prepared = (steps: readonly StoredThinkingStep[], before: number, format: DraftFileFormat): boolean =>
  steps.slice(0, before).some(
    (step) =>
      step.kind === 'skill' &&
      step.scope !== 'deep' &&
      prepares(step.skill, format) &&
      (step.detail?.phase === 'activated' || step.detail?.phase === 'loaded')
  )

interface Group {
  key: string
  file?: string
  members: Member[]
}

export function fileWork(steps: readonly StoredThinkingStep[], live: boolean): FileWork[] {
  const groups: Group[] = []
  const byFile = new Map<string, Group>()
  let calculation: Group | null = null
  for (const run of fileRuns(steps)) {
    const subjects = subjectsOf(run)
    if (subjects.length === 0) {
      if (!calculation) {
        calculation = { key: `calc:${run.id}`, members: [] }
        groups.push(calculation)
      }
      calculation.members.push({ run, kind: 'calculate' })
      continue
    }
    calculation = null
    for (const file of subjects) {
      let group = byFile.get(file)
      if (!group) {
        group = { key: `file:${file}`, file, members: [] }
        byFile.set(file, group)
        groups.push(group)
      }
      const reason = notKeptReason(run, file)
      group.members.push({ run, kind: kindOf(run, file), ...(reason ? { reason } : {}) })
    }
  }
  return groups.map((group) => {
    const runs = group.members.map((member) => member.run)
    const first = runs[0]!
    const work = phasesOf(group.members, live)
    const phases: FilePhase[] =
      group.file && prepared(steps, first.index, formatOfFile(group.file))
        ? [{ kind: 'prepare', state: 'done', attempts: 1 }, ...work]
        : work
    const elapsedMs = sumElapsed(runs)
    const result = [...runs].reverse().find((run) => run.status === 'ok' && run.result)?.result
    return {
      key: group.key,
      ...(group.file ? { file: group.file, format: formatOfFile(group.file) } : {}),
      ...outcomeOf(work),
      phases,
      steps: phases.length,
      attempts: work.at(-1)?.attempts ?? 1,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      documents: mergeInputs(runs),
      ...(result ? { result } : {}),
    }
  })
}

export const hasFileWork = (steps: readonly StoredThinkingStep[]): boolean => steps.some(isFileRun)

export const fileDisplayName = (file: string): string => file.slice(file.lastIndexOf('/') + 1)

const localNumber = (value: number, locale: string): string =>
  value.toLocaleString(locale, { maximumFractionDigits: 4 })

export function resultText(result: string, locale: string): string {
  const text = result.trim()
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return localNumber(Number(text), locale)
  if (!text.startsWith('{')) return text
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return text
    return Object.entries(parsed)
      .map(([name, value]) => `${name} ${typeof value === 'number' ? localNumber(value, locale) : String(value)}`)
      .join(', ')
  } catch {
    return text
  }
}
