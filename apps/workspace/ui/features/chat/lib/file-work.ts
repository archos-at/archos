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
}

export type FileOutcome = 'running' | 'made' | 'edited' | 'checked' | 'calculated' | 'failed'

export interface FileWork {
  key: string
  file?: string
  format?: DraftFileFormat
  outcome: FileOutcome
  failedKind?: FilePhaseKind
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
        documents: inputsOf(detail),
        ...(result ? { result } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      },
    ]
  })
}

const subjectsOf = (run: FileRun): string[] => {
  const kept = [...run.made, ...run.changed]
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

const phasesOf = (
  runs: readonly { run: FileRun; kind: FilePhaseKind }[],
  live: boolean
): FilePhase[] => {
  const phases: Array<FilePhase & { runs: FileRun[] }> = []
  for (const { run, kind } of runs) {
    const last = phases.at(-1)
    if (last && last.kind === kind) {
      last.runs.push(run)
      continue
    }
    phases.push({ kind, state: 'running', attempts: 0, runs: [run] })
  }
  return phases.map(({ runs: members, kind }) => {
    const elapsedMs = sumElapsed(members)
    return {
      kind,
      state: stateOf(members.at(-1)!.status, live),
      attempts: members.length,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    }
  })
}

const outcomeOf = (phases: readonly FilePhase[]): Pick<FileWork, 'outcome' | 'failedKind'> => {
  const last = phases.at(-1)
  if (!last) return { outcome: 'running' }
  if (last.state === 'failed') return { outcome: 'failed', failedKind: last.kind }
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
  members: { run: FileRun; kind: FilePhaseKind }[]
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
      group.members.push({ run, kind: kindOf(run, file) })
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
