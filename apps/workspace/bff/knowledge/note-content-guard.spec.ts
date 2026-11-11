// @disk-inputs: ../../tests/fixtures/memory_note_guard_cases.json
/**
 * @vitest-environment node
 *
 * The memory note guard, held to the table its Python twin reads too
 * (`agent.knowledge.memory_content_guard`,
 * `packages/agent/tests/knowledge/test_memory_content_guard_parity.py`). One
 * fixture at the repo root, read from disk like the content screen's: a case
 * added for one implementation fails the other until both agree.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BadRequestError } from '@/lib/api/errors'
import { assertStorableNote, CONTACT_KINDS, noteRefusal, SECRET_KINDS } from './note-content-guard'
import { noteRefusalKind } from './note-refusal'

interface GuardCase {
  name: string
  text: string
  secret: string | null
  contact: string | null
}
interface Fixture {
  secret_kinds: string[]
  contact_kinds: string[]
  cases: GuardCase[]
}

const FIXTURE_PATH = path.resolve(process.cwd(), '..', '..', 'tests', 'fixtures', 'memory_note_guard_cases.json')
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture

describe('the memory note guard and its Python twin read one table', () => {
  it('holds the kinds defined here', () => {
    expect(fixture.secret_kinds).toEqual([...SECRET_KINDS])
    expect(fixture.contact_kinds).toEqual([...CONTACT_KINDS])
  })

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    // Every shelf refuses a secret; a shared shelf also refuses a contact detail.
    expect(noteRefusal(entry.text, false)).toBe(entry.secret)
    expect(noteRefusal(entry.text, true)).toBe(entry.secret ?? entry.contact)
  })

  it('holds at least twenty notes that must pass', () => {
    expect(fixture.cases.filter((entry) => !entry.secret && !entry.contact).length).toBeGreaterThanOrEqual(20)
  })
})

describe('assertStorableNote', () => {
  it('refuses a secret with a 400 that names the kind and never repeats the value', () => {
    const refuse = () => assertStorableNote('Projektserver-Zugang: Tulpe#4471!', { refuseContact: false })
    expect(refuse).toThrow(BadRequestError)
    expect(refuse).toThrow('A memory note cannot hold a password or access code.')
    expect(refuse).not.toThrow(/Tulpe/)
  })

  it('names the kind in `details`, so a panel can say why in the person\'s language', () => {
    let refused: unknown
    try {
      assertStorableNote('Projektserver-Zugang: Tulpe#4471!', { refuseContact: false })
    } catch (error) {
      refused = error
    }
    expect((refused as BadRequestError).details).toEqual({ reason: 'note_refused', kind: 'credential' })
    expect(noteRefusalKind((refused as BadRequestError).details)).toBe('credential')
    expect(noteRefusalKind({ reason: 'note_refused', kind: 'not_a_kind' })).toBeNull()
    expect(noteRefusalKind({ reason: 'other', kind: 'iban' })).toBeNull()
  })

  it('refuses a contact detail only where the shelf is shared', () => {
    const note = 'Bauherr erreichbar unter +43 664 1234567'
    expect(() => assertStorableNote(note, { refuseContact: true })).toThrow(
      'A note in shared memory cannot hold a phone number.'
    )
    expect(() => assertStorableNote(note, { refuseContact: false })).not.toThrow()
  })

  it('lets a note full of numbers through', () => {
    expect(() =>
      assertStorableNote('EZ 1234, KG 01004; Plan 2024-0815-001; REI 90; 12.03.2027', { refuseContact: true })
    ).not.toThrow()
  })
})
