// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { AUDIT_ACTIONS, AUDIT_SCHEMAS, AWAITING_EMITTER_AUDIT_ACTIONS, RETIRED_AUDIT_ACTIONS } from './schemas.mjs'
import { AUTHORED_REF_KINDS } from '@/lib/documents/document-authors'
import { DOCUMENT_VERSION_TRANSITIONS } from '@/lib/documents/lifecycle-types'
import { nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const SOURCE_ROOT = fileURLToPath(new URL('../..', import.meta.url))

type ActionCarrier =
  | ts.PropertyAssignment
  | ts.PropertySignature
  | ts.ParameterDeclaration
  | ts.VariableDeclaration
  | ts.TypeAliasDeclaration

function carriesAction(node: ts.Node): node is ActionCarrier {
  if (ts.isTypeAliasDeclaration(node)) return /AuditAction$/.test(node.name.text)
  const named =
    ts.isPropertyAssignment(node) ||
    ts.isPropertySignature(node) ||
    ts.isParameter(node) ||
    ts.isVariableDeclaration(node)
  return named && ts.isIdentifier(node.name) && node.name.text === 'action'
}

function emittedAuditActions(): string[] {
  return productionSources(SOURCE_ROOT).flatMap((file) => {
    const source = parseSource(file, SOURCE_ROOT)
    const writesAudit = nodesOf(source, ts.isIdentifier).some((id) => id.text.startsWith('recordAuditEvent'))
    if (!writesAudit) return []
    return nodesOf(source, carriesAction).flatMap((carrier) =>
      nodesOf(carrier, ts.isStringLiteralLike).map((literal) => literal.text),
    )
  })
}

const EMITTED_ACTIONS: ReadonlySet<string> = new Set([
  ...DOCUMENT_VERSION_TRANSITIONS.map((row) => row.auditAction),
  ...emittedAuditActions(),
])

type AuditAction = keyof typeof AUDIT_SCHEMAS

const METADATA_TYPES = ['string', 'number', 'boolean'] as const
type MetadataType = (typeof METADATA_TYPES)[number]

interface AuditSchemaSpec {
  readonly targets: readonly { readonly type: string }[]
  readonly metadata?: Readonly<Record<string, MetadataType>>
}

const REGISTRY: Record<AuditAction, AuditSchemaSpec> = AUDIT_SCHEMAS

describe('audit schema coverage', () => {
  it('registers a schema for every action the app may emit', () => {
    const withoutSchema = AUDIT_ACTIONS.filter((action) => !REGISTRY[action])
    expect(withoutSchema).toEqual([])
  })

  it('emits every action it registers a schema for — no orphan schemas', () => {
    const retired = new Set<string>(RETIRED_AUDIT_ACTIONS)
    const awaiting = new Set<string>(AWAITING_EMITTER_AUDIT_ACTIONS)
    const onTheWire = new Set<string>(EMITTED_ACTIONS)
    const orphans = Object.keys(REGISTRY).filter(
      (action) => !onTheWire.has(action) && !retired.has(action) && !awaiting.has(action),
    )
    expect(orphans).toEqual([])
  })

  it('takes an action off the awaiting list the moment it has an emitter, so the list only shrinks', () => {
    expect(AWAITING_EMITTER_AUDIT_ACTIONS.filter((action) => EMITTED_ACTIONS.has(action))).toEqual([])
    expect(AWAITING_EMITTER_AUDIT_ACTIONS.filter((action) => !(action in REGISTRY))).toEqual([])
  })

  it('writes no retired action: those stay registered for history only', () => {
    expect(RETIRED_AUDIT_ACTIONS.filter((action) => EMITTED_ACTIONS.has(action))).toEqual([])
    expect(RETIRED_AUDIT_ACTIONS.filter((action) => !(action in REGISTRY))).toEqual([])
  })

  it('finds the emitters at all — the scan is evidence, not an empty set', () => {
    expect(EMITTED_ACTIONS.size).toBeGreaterThanOrEqual(
      AUDIT_ACTIONS.length - RETIRED_AUDIT_ACTIONS.length - AWAITING_EMITTER_AUDIT_ACTIONS.length,
    )
    expect(EMITTED_ACTIONS).toContain('document.generated')
    expect(EMITTED_ACTIONS).toContain('llm_credential.created')
    expect(EMITTED_ACTIONS).toContain('llm_credential.rotated')
  })

  it('lists each action exactly once', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })

  it('covers the actions reported by issues #255 and #256', () => {
    expect(AUDIT_ACTIONS).toContain('resource.shared')
    expect(AUDIT_ACTIONS).toContain('resource.ownership.escalated')
  })

  it('gives document.generated its own action, with what produced it as a target', () => {
    const generated = REGISTRY['document.generated']
    expect(generated.targets.map((target) => target.type)).toEqual([
      'document',
      'agent_run',
      'answer_artifact',
    ])
    expect(Object.keys(generated.metadata ?? {})).not.toContain('runId')
  })

  it('registers EVERY reference kind an agent-authored event can carry, and no other', () => {
    const registered = REGISTRY['document.generated'].targets.map((target) => target.type)
    for (const kind of AUTHORED_REF_KINDS) expect(registered, kind).toContain(kind)

    const emittable = new Set<string>(['document', ...AUTHORED_REF_KINDS])
    expect(registered.filter((type) => !emittable.has(type))).toEqual([])
  })

  it('keeps every word anyone wrote out of what the agent did: ids, numbers, kinds and counts only', () => {
    const CONTENT = /body|content|text|note|title|label|name|summary|payload|path|comment|value|rationale/i
    const agentEntries = Object.entries(REGISTRY).filter(([action]) => action.startsWith('agent.'))
    expect(agentEntries.length).toBeGreaterThanOrEqual(9)
    for (const [action, schema] of agentEntries) {
      expect(Object.keys(schema.metadata ?? {}).filter((key) => CONTENT.test(key)), action).toEqual([])
    }
  })

  it('keeps a stranger\'s mail out of the E-Mail-Eingang\'s trail: ids, codes, counts and flags only', () => {
    const PERSONAL = /body|content|text|note|title|label|name|summary|subject|address|token|domain|email|file|path/i
    const mail = Object.entries(REGISTRY).filter(([action]) => /^(inbound_mail|inbound_mail_address|mail_thread)\./.test(action))
    expect(mail.map(([action]) => action).sort()).toEqual(
      [
        'inbound_mail.decided',
        'inbound_mail.expired',
        'inbound_mail.original_read',
        'inbound_mail.part_read',
        'inbound_mail.received',
        'inbound_mail.reported',
        'inbound_mail_address.created',
        'inbound_mail_address.deleted',
        'inbound_mail_address.forwards_changed',
        'inbound_mail_address.rotated',
        'mail_thread.entry_detached',
        'mail_thread.follow_ended',
        'mail_thread.follow_started',
        'mail_thread.original_read',
      ].sort(),
    )
    for (const [action, schema] of mail) {
      const keys = Object.keys(schema.metadata ?? {}).filter((key) => !/Id$/.test(key))
      expect(keys.filter((key) => PERSONAL.test(key)), action).toEqual([])
    }
  })

  it('names at least one target type per action — WorkOS requires one', () => {
    for (const [action, schema] of Object.entries(REGISTRY)) {
      expect(schema.targets.length, action).toBeGreaterThan(0)
      for (const target of schema.targets) expect(target.type, action).toBeTruthy()
    }
  })

  it('declares metadata as WorkOS TYPE NAMES, never example values', () => {
    for (const [action, schema] of Object.entries(REGISTRY)) {
      for (const [key, type] of Object.entries(schema.metadata ?? {})) {
        expect(METADATA_TYPES, `${action}.${key}`).toContain(type)
      }
    }
  })
})
