import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { rulesetValuesSchema } from '../../apps/workspace/bff/base-knowledge/wire/ruleset'
import type { StoredRuleset } from '../../apps/workspace/bff/base-knowledge/rulesets/select'
import { projectIntakeDefinitionV1 as definition } from '../../apps/workspace/bff/project-profile/intake-definition'
import type { DocumentEvidence } from '../../apps/workspace/bff/project-profile/evidence-schema'
import { emptyProjectProfile } from '../../apps/workspace/bff/project-profile/patch-engine'
import { ProjectProfileSchema, type ProjectProfile } from '../../apps/workspace/bff/project-profile/types'
import { computeNeeds } from '../../apps/workspace/bff/project-intake/needs'
import {
  planRecord,
  planWithdraw,
  staticRefusal,
  type ScreenedValue,
} from '../../apps/workspace/bff/project-intake/record'
import {
  internalIntakeRequestSchema,
  type DismissedValue,
  type IntakeMode,
  type RecordRefusalReason,
} from '../../apps/workspace/bff/project-intake/types'

interface GateRequest {
  op: 'empty' | 'needs' | 'record' | 'withdraw'
  profile?: unknown
  mode?: IntakeMode
  dismissed?: DismissedValue[]
  body?: unknown
  readableFiles?: string[]
}

type Screened = { key: string; screened: ScreenedValue | null; refusal: RecordRefusalReason | null }

function reasonFromEvidence(evidence: Pick<DocumentEvidence, 'fileName' | 'page' | 'quote'>): string {
  const where = evidence.page ? `${evidence.fileName}, S. ${evidence.page}` : evidence.fileName
  return `${where}: „${evidence.quote}"`
}

const pack: { records: Array<{ key: string; values: unknown }> } = JSON.parse(
  readFileSync(join(import.meta.dir, '..', '..', 'configs', 'knowledge-packs', 'at-setup.json'), 'utf8')
)
const records: readonly StoredRuleset[] = pack.records.map((record) => ({
  id: `ruleset:${record.key}`,
  values: rulesetValuesSchema.parse(record.values),
}))

function needs(request: GateRequest) {
  const profile = ProjectProfileSchema.parse(request.profile ?? {})
  return { needs: computeNeeds(profile, definition, { mode: request.mode ?? 'active', dismissed: request.dismissed ?? [], records }) }
}

function record(request: GateRequest) {
  const parsed = internalIntakeRequestSchema.safeParse(request.body)
  if (!parsed.success || parsed.data.op !== 'record') {
    return { status: 400, error: parsed.success ? 'not a record body' : parsed.error.issues[0]?.message }
  }
  const profile: ProjectProfile = ProjectProfileSchema.parse(request.profile ?? {})
  const readableFiles = new Set(request.readableFiles ?? [])
  const dismissed = request.dismissed ?? []
  const screened: Screened[] = parsed.data.values.map((value) => {
    const refusal = staticRefusal(value, { definition, dismissed, readableFiles })
    if (refusal) return { key: value.key, screened: null, refusal }
    const evidence: DocumentEvidence = { kind: 'document', ...value.evidence }
    const reason = reasonFromEvidence(evidence)
    return { key: value.key, screened: { key: value.key, value: value.value, evidence, reason }, refusal: null }
  })
  const plan = planRecord(profile, definition, screened, {
    now: new Date().toISOString(),
    readingId: parsed.data.jobId,
    needs: { mode: request.mode ?? 'active', dismissed, records },
    records,
  })
  return { status: 200, results: plan.results, opened: plan.opened, profile: plan.profile }
}

function withdraw(request: GateRequest) {
  const parsed = internalIntakeRequestSchema.safeParse(request.body)
  if (!parsed.success || parsed.data.op !== 'withdraw') {
    return { status: 400, error: parsed.success ? 'not a withdraw body' : parsed.error.issues[0]?.message }
  }
  const profile: ProjectProfile = ProjectProfileSchema.parse(request.profile ?? {})
  const plan = planWithdraw(profile, definition, parsed.data.keys, {
    now: new Date().toISOString(),
    readingId: parsed.data.jobId,
    records,
  })
  return { status: 200, results: plan.results, profile: plan.profile }
}

function answer(request: GateRequest): unknown {
  if (request.op === 'empty') return { profile: emptyProjectProfile() }
  if (request.op === 'needs') return needs(request)
  if (request.op === 'record') return record(request)
  if (request.op === 'withdraw') return withdraw(request)
  return { status: 400, error: `unknown op ${String(request.op)}` }
}

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let reply: unknown
  try {
    reply = answer(JSON.parse(line) as GateRequest)
  } catch (error) {
    reply = { status: 500, error: error instanceof Error ? error.message : String(error) }
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`)
})
