import type { JobHandler } from '@/lib/jobs-queue/handlers'
import { BFF_JOB_KINDS, type BffJobKind } from '@/lib/jobs-queue/types'

export interface HandledCall {
  id: string
  organizationId: string
  attempts: number
  startedAt: number
  endedAt: number
}

export const handled: HandledCall[] = []

type Script = { id: string; mode: 'ok' | 'fail-once' | 'fail-always' | 'slices'; ms?: number; left?: number; waitMs?: number }

const scripted: JobHandler = async ({ organizationId, payload, attempts }) => {
  const script = payload as Script
  const startedAt = Date.now()
  const record = () => handled.push({ id: script.id, organizationId, attempts, startedAt, endedAt: Date.now() })
  if (script.ms) await new Promise((resolve) => setTimeout(resolve, script.ms))
  if (script.mode === 'fail-always' || (script.mode === 'fail-once' && attempts === 1)) {
    record()
    throw new Error(`scripted failure of ${script.id} on attempt ${attempts}`)
  }
  record()
  if (script.mode === 'slices' && (script.left ?? 0) > 1) {
    const next = { ...script, left: (script.left ?? 0) - 1 }
    return { done: false, payload: next, ...(script.waitMs ? { notBefore: new Date(Date.now() + script.waitMs) } : {}) }
  }
  return { done: true, payload: script }
}

export const SCRIPTED_HANDLERS = Object.fromEntries(BFF_JOB_KINDS.map((kind) => [kind, scripted])) as Record<BffJobKind, JobHandler>
