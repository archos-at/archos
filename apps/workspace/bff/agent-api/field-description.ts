import { z } from 'zod'

type Schema = z.core.$ZodType

const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional'])

function wrapped(schema: Schema): Schema | null {
  const def = schema._zod.def
  if (WRAPPERS.has(def.type)) return (def as z.core.$ZodOptionalDef).innerType
  if (def.type === 'lazy') return (def as z.core.$ZodLazyDef).getter()
  if (def.type !== 'pipe') return null
  const pipe = def as z.core.$ZodPipeDef
  return pipe.in._zod.def.type === 'transform' ? pipe.out : pipe.in
}

function* layers(schema: Schema): Generator<Schema> {
  let current: Schema | null = schema
  while (current) {
    yield current
    current = wrapped(current)
  }
}

function child(schema: Schema, step: PropertyKey): Schema | null {
  const def = schema._zod.def
  if (def.type === 'object') return (def as z.core.$ZodObjectDef).shape[String(step)] ?? null
  if (def.type === 'record') return (def as z.core.$ZodRecordDef).valueType
  if (def.type === 'array' && typeof step === 'number') return (def as z.core.$ZodArrayDef).element
  return null
}

export function fieldDescription(schema: Schema, path: readonly PropertyKey[]): string | undefined {
  let current: Schema = schema
  for (const step of path) {
    let next: Schema | null = null
    for (const layer of layers(current)) {
      next = child(layer, step)
      if (next) break
    }
    if (!next) return undefined
    current = next
  }
  for (const layer of layers(current)) {
    const description = z.globalRegistry.get(layer)?.description
    if (description) return description
  }
  return undefined
}
