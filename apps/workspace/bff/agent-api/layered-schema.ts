type Node = Record<string, unknown>

export const LAYER_THRESHOLD_CHARS = 4_000
const INLINE_FIELD_CHARS = 800
const INLINE_EXAMPLES_CHARS = 1_000

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function size(value: unknown): number {
  return JSON.stringify(value).length
}

function objectOf(node: Node): Node | null {
  if (isNode(node.properties)) return node
  if (isNode(node.items)) return objectOf(node.items)
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key]
    if (!Array.isArray(branches)) continue
    const live = branches.filter((branch): branch is Node => isNode(branch) && branch.type !== 'null')
    if (live.length === 1) return objectOf(live[0] as Node)
  }
  return null
}

function fieldNames(node: Node): string[] {
  const target = objectOf(node)
  return target && isNode(target.properties) ? Object.keys(target.properties) : []
}

export type FieldResolution = { node: Node } | { error: string }

export function resolveField(root: Node, field: string): FieldResolution {
  let current = root
  const walked: string[] = []
  for (const step of field.split('.')) {
    const target = objectOf(current)
    const properties = target && isNode(target.properties) ? target.properties : null
    const next = properties?.[step]
    if (!isNode(next)) {
      const where = walked.length > 0 ? ` under "${walked.join('.')}"` : ''
      const known = properties ? Object.keys(properties) : []
      return {
        error:
          `no field "${step}"${where} in this input. ` +
          (known.length > 0 ? `Fields there: ${known.join(', ')}.` : 'That part has no named fields to open.'),
      }
    }
    current = next
    walked.push(step)
  }
  return { node: current }
}

function outline(node: Node, path: string): Node {
  const names = fieldNames(node)
  const shape = node.type === 'array' ? 'array of objects' : undefined
  return {
    ...(node.type === undefined ? {} : { type: node.type }),
    ...(node.description === undefined ? {} : { description: node.description }),
    ...(shape && names.length > 0 ? { items: shape } : {}),
    ...(names.length > 0 ? { fields: names } : {}),
    ...(Array.isArray(node.required) && node.required.length > 0 ? { required: node.required } : {}),
    describe: `Large. Call describe-operation again with field: "${path}" for its full schema.`,
  }
}

export interface LayeredSchema {
  readonly schema: Node
  readonly layered: boolean
}

export function layerSchema(node: Node, prefix = ''): LayeredSchema {
  if (size(node) <= LAYER_THRESHOLD_CHARS) return { schema: node, layered: false }
  if (!isNode(node.properties) && isNode(node.items)) {
    const items = layerSchema(node.items, prefix)
    return { schema: { ...node, items: items.schema }, layered: items.layered }
  }
  const target = objectOf(node)
  if (!target || target !== node || !isNode(target.properties)) return { schema: node, layered: false }
  const properties = Object.fromEntries(
    Object.entries(target.properties).map(([name, value]) => {
      if (!isNode(value) || size(value) <= INLINE_FIELD_CHARS) return [name, value]
      return [name, outline(value, prefix ? `${prefix}.${name}` : name)]
    }),
  )
  const kept = (key: string) => (node[key] === undefined ? {} : { [key]: node[key] })
  return {
    schema: {
      ...kept('type'),
      ...kept('description'),
      properties,
      ...kept('required'),
      ...kept('additionalProperties'),
      ...(node.examples !== undefined && size(node.examples) <= INLINE_EXAMPLES_CHARS ? { examples: node.examples } : {}),
    },
    layered: true,
  }
}
