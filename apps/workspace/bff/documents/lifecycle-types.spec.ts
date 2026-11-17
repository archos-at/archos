/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS } from '@/lib/audit/schemas.mjs'

import {
  AGENT_REACHABLE_OPS,
  DOCUMENT_VERSION_EFFECTS,
  DOCUMENT_VERSION_OPS,
  DOCUMENT_VERSION_STATES,
  DOCUMENT_VERSION_TRANSITIONS,
  findDocumentVersionTransition,
  type DocumentVersionTransition,
} from './lifecycle-types'

describe('the transition table is coherent', () => {
  it('has at least one row per declared op', () => {
    for (const op of DOCUMENT_VERSION_OPS) {
      expect(
        DOCUMENT_VERSION_TRANSITIONS.some((row) => row.op === op),
        `op ${op} has no transition row`,
      ).toBe(true)
    }
  })

  it('names only declared states and declared effects', () => {
    for (const row of DOCUMENT_VERSION_TRANSITIONS) {
      if (row.from !== null) expect(DOCUMENT_VERSION_STATES).toContain(row.from)
      expect(DOCUMENT_VERSION_STATES).toContain(row.to)
      for (const effect of row.effects) expect(DOCUMENT_VERSION_EFFECTS).toContain(effect)
    }
  })

  it('names only audit actions the registry knows', () => {
    for (const row of DOCUMENT_VERSION_TRANSITIONS) {
      expect(AUDIT_ACTIONS, `${row.op} emits an unregistered action`).toContain(row.auditAction)
    }
  })

  it('never lets a (from, op) pair mean two things', () => {
    const keys = DOCUMENT_VERSION_TRANSITIONS.map((row) => `${row.from}:${row.op}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('derives the machine-reachable ops from `actor`, and they are exactly three', () => {
    expect([...AGENT_REACHABLE_OPS].sort()).toEqual(['create', 'submit', 'update'])
  })

  it('makes every decision that asserts content a person’s', () => {
    for (const op of ['approve', 'request_changes', 'reject', 'publish', 'upload'] as const) {
      for (const row of DOCUMENT_VERSION_TRANSITIONS.filter((entry) => entry.op === op)) {
        expect(row.actor, `${op} must be a human decision`).toBe('human')
      }
    }
  })

  it('marks the two submit rows as opening a round that has to reach somebody', () => {
    for (const row of DOCUMENT_VERSION_TRANSITIONS.filter((entry) => entry.op === 'submit')) {
      expect(row.requires.reviewer, `${row.from}:submit must resolve reviewers`).toBe(true)
    }
    const rows: readonly DocumentVersionTransition[] = DOCUMENT_VERSION_TRANSITIONS
    const carrying = rows.filter((row) => row.requires.reviewer)
    expect(new Set(carrying.map((row) => row.op))).toEqual(new Set(['submit']))
  })

  it('requires a comment on both refusals and on neither approval', () => {
    expect(findDocumentVersionTransition('in_review', 'request_changes')?.requires.comment).toBe(true)
    expect(findDocumentVersionTransition('in_review', 'reject')?.requires.comment).toBe(true)
    expect(findDocumentVersionTransition('in_review', 'approve')?.requires.comment).toBeUndefined()
  })

  it('makes „darf freigeben“ project:edit and nothing else', () => {
    for (const op of ['approve', 'request_changes', 'reject'] as const) {
      for (const row of DOCUMENT_VERSION_TRANSITIONS.filter((entry) => entry.op === op)) {
        expect([...row.permission], `${op} is reachable with more than project:edit`).toEqual([
          'project:edit',
        ])
      }
    }
  })

  it('asks for `project:documents:generate` exactly where a machine may write', () => {
    const rows: readonly DocumentVersionTransition[] = DOCUMENT_VERSION_TRANSITIONS
    for (const row of rows) {
      const machineWrite = row.actor === 'either' && (row.op === 'create' || row.op === 'update')
      expect(Boolean(row.alsoRequires), `${row.from}:${row.op}`).toBe(machineWrite)
    }
  })
})
