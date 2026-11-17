/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { answerExportCopy } from '@/i18n/namespaces/answer-export'
import { loadCardJsonSchema } from '@/test-utils/card-json-schema'
import { exportKindOf, SKIPPED_FIELDS } from './cards'

const cardJsonSchema = loadCardJsonSchema()

interface JsonSchemaNode {
  $ref?: string
  anyOf?: JsonSchemaNode[]
  oneOf?: JsonSchemaNode[]
  items?: JsonSchemaNode
  const?: unknown
  default?: unknown
  enum?: unknown[]
  properties?: Record<string, JsonSchemaNode>
}
interface JsonSchemaDocument {
  $defs: Record<string, JsonSchemaNode>
  oneOf: Array<{ $ref: string }>
}

const document = cardJsonSchema as unknown as JsonSchemaDocument
const defs = document.$defs
const cardDefNames = document.oneOf.map((entry) => entry.$ref.split('/').pop() as string)

const cardTypeOf = (defName: string): string | undefined => {
  const node = defs[defName]?.properties?.type
  const value = node?.const ?? node?.default
  return typeof value === 'string' ? value : undefined
}

const referencedDefs = (node: JsonSchemaNode | undefined, found = new Set<string>(), depth = 0) => {
  if (!node || depth > 8) return found
  if (typeof node.$ref === 'string') found.add(node.$ref.split('/').pop() as string)
  for (const member of [...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
    referencedDefs(member, found, depth + 1)
  }
  referencedDefs(node.items, found, depth + 1)
  return found
}

const labelledFields = new Map<string, string[]>()

const schemaPaths = new Set<string>()

const vocabularyAt = new Map<string, Set<string>>()

const enumMembers = (node: JsonSchemaNode | undefined, depth = 0): Set<string> => {
  const found = new Set<string>()
  if (!node || depth > 8) return found
  for (const member of node.enum ?? []) if (typeof member === 'string') found.add(member)
  for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
    for (const member of enumMembers(branch, depth + 1)) found.add(member)
  }
  return found
}

const collect = (defName: string, path: string, top: boolean, seen: Set<string>) => {
  if (seen.has(defName)) return // a self-referential model would otherwise not terminate
  const nextSeen = new Set(seen).add(defName)
  for (const [name, property] of Object.entries(defs[defName]?.properties ?? {})) {
    if (name === 'type') continue
    if (top && SKIPPED_FIELDS.has(name)) continue
    const here = `${path}.${name}`
    labelledFields.set(name, [...(labelledFields.get(name) ?? []), here])
    schemaPaths.add(here)
    const members = enumMembers(property)
    if (members.size > 0) vocabularyAt.set(here, members)
    for (const nested of referencedDefs(property)) {
      if (defs[nested]?.properties) collect(nested, here, false, nextSeen)
    }
  }
}

const exportedTypes: string[] = []
const walkedTypes: string[] = []
for (const defName of cardDefNames) {
  const type = cardTypeOf(defName)
  if (!type) continue
  const kind = exportKindOf(type)
  if (kind === 'chrome') continue
  exportedTypes.push(type)
  if (kind === 'content') {
    walkedTypes.push(type)
    collect(defName, type, true, new Set())
  }
}

const fields = answerExportCopy.messages.en.fields as Record<string, string | undefined>
const cardTypes = answerExportCopy.messages.en.cardTypes as Record<string, string | undefined>
const values = answerExportCopy.messages.en.values as Record<string, Record<string, string | undefined>>

const flattenKeys = (node: unknown, prefix: string, into: Set<string>): Set<string> => {
  if (typeof node === 'string') {
    into.add(prefix)
    return into
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      flattenKeys(child, prefix ? `${prefix}.${key}` : key, into)
    }
  }
  return into
}

const overrideKeys = [...flattenKeys(answerExportCopy.messages.en.fieldsByPath, '', new Set<string>())].sort()

const parseOverride = (key: string) => {
  const [path, condition] = key.split('?')
  const [sibling, member] = condition ? condition.split('=') : []
  return { path, sibling, member }
}

describe('every label an exported card can print is a translated word', () => {
  it('names every field the walker labels', () => {
    const humanized = [...labelledFields.entries()]
      .filter(([name]) => typeof fields[name] !== 'string')
      .map(([name, paths]) => `${name}  (${paths.sort().join(', ')})`)

    expect(
      humanized.sort(),
      'These field names have no entry in `answerExport.fields`, so `fieldLabel` ' +
        'humanizes them — a German compliance document prints „Current step“ and ' +
        '„To value“ beside „Fundstelle“ and „Einheit“. Add each one to ' +
        'i18n/dictionaries/en/answer-export.ts; German follows by compile error.'
    ).toEqual([])
  })

  it('names every card type, for the cards that carry no title of their own', () => {
    const humanized = exportedTypes.filter((type) => typeof cardTypes[type] !== 'string')

    expect(
      humanized.sort(),
      'These card types have no entry in `answerExport.cardTypes`, so a card of ' +
        'this type with no usable title is headed with a humanized form of its ' +
        'own type name — „Verdict header“ at the top of a German finding.'
    ).toEqual([])
  })

  it('is actually walking the catalogue', () => {
    expect(walkedTypes.length).toBeGreaterThan(8)
    expect(labelledFields.size).toBeGreaterThan(50)
    expect(labelledFields.get('factor')).toContain('calculation.steps.operands.factor')
    expect(vocabularyAt.size).toBeGreaterThan(15)
    expect(vocabularyAt.get('calculation.limit.comparator')).toContain('between')
    expect(vocabularyAt.get('stair_diagram.riser_height.status')).toContain('needs_input')
  })
})

describe('every per-path label override still points at a field that exists', () => {
  it('names a path the card schema has', () => {
    const dangling = overrideKeys
      .filter((key) => !schemaPaths.has(parseOverride(key).path))
      .map((key) => `${key}  (no such path in contracts/cards/schemas.json)`)

    expect(
      dangling,
      'These `fieldsByPath` keys name a payload path no card carries any more. ' +
        'Either the field was renamed — follow it — or the card was removed and ' +
        'the override with it. A key that resolves to nothing is a label that ' +
        'silently reverted to the flat map.'
    ).toEqual([])
  })

  it('conditions only on a sibling field that exists and a member it can hold', () => {
    const broken: string[] = []
    for (const key of overrideKeys) {
      const { path, sibling, member } = parseOverride(key)
      if (!sibling) continue
      const parent = path.split('.').slice(0, -1).join('.')
      const siblingPath = `${parent}.${sibling}`
      if (!schemaPaths.has(siblingPath)) {
        broken.push(`${key}  (no sibling ${siblingPath})`)
        continue
      }
      if (!vocabularyAt.get(siblingPath)?.has(member)) {
        broken.push(`${key}  (${siblingPath} cannot hold '${member}')`)
      }
    }

    expect(
      broken,
      'A conditional override reads „use this label when the sibling says that“. ' +
        'The sibling has to exist and the member has to be one it can actually ' +
        'carry, or the condition is never true and the override never applies.'
    ).toEqual([])
  })

  it('does not condition one path on two different siblings', () => {
    const siblingsPerPath = new Map<string, Set<string>>()
    for (const key of overrideKeys) {
      const { path, sibling } = parseOverride(key)
      if (!sibling) continue
      siblingsPerPath.set(path, (siblingsPerPath.get(path) ?? new Set()).add(sibling))
    }
    const ambiguous = [...siblingsPerPath.entries()]
      .filter(([, siblings]) => siblings.size > 1)
      .map(([path, siblings]) => `${path}  (${[...siblings].sort().join(', ')})`)

    expect(ambiguous, 'which override wins would depend on stored key order').toEqual([])
  })
})

describe('every value an exported card can print is a translated word', () => {
  const reachable = new Map<string, Set<string>>()
  for (const [path, members] of vocabularyAt) {
    const name = path.split('.').pop() as string
    const known = reachable.get(name) ?? new Set<string>()
    for (const member of members) known.add(member)
    reachable.set(name, known)
  }

  it('names every member of every enum a card carries', () => {
    const untranslated: string[] = []
    for (const [name, members] of reachable) {
      for (const member of [...members].sort()) {
        if (typeof values[name]?.[member] !== 'string') {
          untranslated.push(`${name}.${member}`)
        }
      }
    }

    expect(
      untranslated.sort(),
      'These enum members have no word in `answerExport.values`, so the walker ' +
        'prints the wire value: „Wirkung | tightens“, „Rang | verordnung“. Add ' +
        'each one to i18n/dictionaries/en/answer-export.ts; German follows ' +
        'by compile error.'
    ).toEqual([])
  })

  it('carries no word for a member the catalogue can no longer emit', () => {
    const dead: string[] = []
    for (const [name, members] of Object.entries(values)) {
      for (const member of Object.keys(members)) {
        if (!reachable.get(name)?.has(member)) dead.push(`${name}.${member}`)
      }
    }

    expect(
      dead.sort(),
      'These words translate a member no exported card can hold. Either the ' +
        '`Literal` lost it — delete the word — or the field is no longer ' +
        'reachable, in which case the whole vocabulary is stale.'
    ).toEqual([])
  })
})
