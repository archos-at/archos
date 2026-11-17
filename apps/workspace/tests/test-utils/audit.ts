import { expect } from 'vitest'
import type { AuditEventInput } from '@/lib/audit/service'
import { AUDIT_SCHEMAS } from '@/lib/audit/schemas.mjs'

type Registry = Readonly<
  Record<
    string,
    {
      readonly targets: readonly { readonly type: string }[]
      readonly metadata?: Readonly<Record<string, string>>
    }
  >
>

const REGISTRY: Registry = AUDIT_SCHEMAS

export function expectRegistered(input: AuditEventInput): void {
  const schema = REGISTRY[input.action]
  expect(schema, input.action).toBeDefined()
  const registered = schema.targets.map((target) => target.type)
  for (const type of [
    input.targetType,
    ...(input.alsoTargets ?? []).map((target) => target.type),
  ]) {
    expect(registered, `${input.action} target`).toContain(type)
  }
  const keys = Object.keys(schema.metadata ?? {})
  for (const key of Object.keys(input.metadata ?? {}))
    expect(keys, `${input.action} metadata`).toContain(key)
}
