import { z } from 'zod'

export type JsonSchemaNode = Record<string, unknown>

export class UnsupportedSchemaNodeError extends Error {
  constructor(readonly typeName: string) {
    super(`The JSON Schema export cannot describe a ${typeName}. Describe the wire shape with a representable schema.`)
    this.name = 'UnsupportedSchemaNodeError'
  }
}

const UNREPRESENTABLE = new Set(['bigint', 'symbol', 'undefined', 'void', 'map', 'set', 'transform', 'nan', 'custom', 'function', 'promise'])

const FORMAT_PATTERNS_DROPPED = new Set(['uuid', 'guid', 'datetime', 'email'])

type OverrideContext = Parameters<NonNullable<NonNullable<Parameters<typeof z.toJSONSchema>[1]>['override']>>[0]

function endsInTransform(schema: z.core.$ZodType): boolean {
  const def = schema._zod.def
  if (def.type === 'transform') return true
  return def.type === 'pipe' && endsInTransform((def as z.core.$ZodPipeDef).out)
}

function replaceWith(target: JsonSchemaNode, source: JsonSchemaNode): void {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, source)
}

function override({ zodSchema, jsonSchema }: OverrideContext): void {
  const def = zodSchema._zod.def
  if (def.type === 'date') {
    jsonSchema.type = 'string'
    jsonSchema.format = 'date-time'
    return
  }
  if (UNREPRESENTABLE.has(def.type)) throw new UnsupportedSchemaNodeError(def.type)
  if (def.type === 'pipe') {
    const pipe = def as z.core.$ZodPipeDef
    if (endsInTransform(pipe.in)) replaceWith(jsonSchema, { ...toJsonSchema(pipe.out), ...descriptionOf(zodSchema) })
    return
  }
  if (def.type === 'union' && 'discriminator' in def && typeof def.discriminator === 'string') {
    jsonSchema.discriminator = { propertyName: def.discriminator }
    return
  }
  if (def.type === 'string') {
    dropFormatPatterns(zodSchema, jsonSchema)
    return
  }
  if (def.type === 'number') {
    if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) delete jsonSchema.minimum
    if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) delete jsonSchema.maximum
    return
  }
  if (def.type === 'literal' && 'const' in jsonSchema) {
    delete jsonSchema.type
    return
  }
  if (def.type === 'record' && isPlainStringSchema(jsonSchema.propertyNames)) {
    delete jsonSchema.propertyNames
    return
  }
  if (def.type === 'tuple' && jsonSchema.items === false) {
    delete jsonSchema.items
    return
  }
  if (def.type === 'object') objectNode(def as z.core.$ZodObjectDef, jsonSchema)
}

function isPlainStringSchema(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length === 1 && (value as JsonSchemaNode).type === 'string'
}

function objectNode(def: z.core.$ZodObjectDef, jsonSchema: JsonSchemaNode): void {
  if (isEmptyObject(jsonSchema.additionalProperties)) delete jsonSchema.additionalProperties
  const required = Object.keys(def.shape).filter((key) => !z.safeParse(def.shape[key], undefined).success)
  if (required.length > 0) jsonSchema.required = required
  else delete jsonSchema.required
}

function formatPatterns(schema: z.core.$ZodType): Set<string> {
  const checks: z.core.$ZodType[] = [schema, ...((schema._zod.def as { checks?: z.core.$ZodType[] }).checks ?? [])]
  const sources = new Set<string>()
  for (const check of checks) {
    const def = check._zod.def as { check?: string; format?: string; pattern?: RegExp }
    if (def.check === 'string_format' && FORMAT_PATTERNS_DROPPED.has(String(def.format)) && def.pattern) {
      sources.add(def.pattern.source)
    }
  }
  return sources
}

function dropFormatPatterns(schema: z.core.$ZodType, jsonSchema: JsonSchemaNode): void {
  const dropped = formatPatterns(schema)
  if (dropped.size === 0) return
  if (typeof jsonSchema.pattern === 'string' && dropped.has(jsonSchema.pattern)) delete jsonSchema.pattern
  if (!Array.isArray(jsonSchema.allOf)) return
  const kept = (jsonSchema.allOf as JsonSchemaNode[]).filter((part) => !dropped.has(String(part.pattern)))
  delete jsonSchema.allOf
  if (kept.length === 1) Object.assign(jsonSchema, kept[0])
  if (kept.length > 1) jsonSchema.allOf = kept
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0
}

function descriptionOf(schema: z.core.$ZodType): JsonSchemaNode {
  const description = z.globalRegistry.get(schema)?.description
  return description ? { description } : {}
}

export function toJsonSchema(schema: z.core.$ZodType): JsonSchemaNode {
  const { $schema: _dialect, ...node } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
    override,
  }) as JsonSchemaNode
  return node
}

export function jsonSchemaDocument(
  schemas: Record<string, z.core.$ZodType>,
  meta: { title: string; description: string },
): JsonSchemaNode {
  const defs: Record<string, JsonSchemaNode> = {}
  for (const [name, schema] of Object.entries(schemas)) {
    defs[name] = toJsonSchema(schema)
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: meta.title,
    description: meta.description,
    $defs: defs,
  }
}
