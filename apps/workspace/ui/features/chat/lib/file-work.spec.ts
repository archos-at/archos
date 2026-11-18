/**
 * @vitest-environment node
 */

import { describe, expect, test } from 'vitest'
import { translatorFor } from '@/i18n/namespace'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { StepDetailValue, StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { storedSteps } from '@/test-utils/wire-v2-steps'
import { fileRuns, fileWork, resultText } from './file-work'
import { liveLine } from './turn-events'

const tDe = translatorFor(chatCopy, 'de')
const tEn = translatorFor(chatCopy, 'en')

let clock = 0

const run = (
  id: string,
  detail: Record<string, StepDetailValue>,
  { complete = true, key = 'status.action.fileMake', values = {} as Record<string, string> } = {}
): StoredThinkingStep => ({
  id: `status:file-run:${id}`,
  userMessageId: 'u1',
  timestamp: new Date(Date.UTC(2026, 10, 18, 9, 0, clock++)).toISOString(),
  isComplete: complete,
  kind: 'status',
  slot: `file-run:${id}`,
  turnEvent: { key, values },
  detail,
})

const skill = (name: string): StoredThinkingStep => ({
  id: `skill:${name}`,
  userMessageId: 'u1',
  timestamp: new Date(Date.UTC(2026, 10, 18, 9, 0, clock++)).toISOString(),
  isComplete: true,
  kind: 'skill',
  skill: name,
  detail: { phase: 'loaded', hidden: false },
})

const making = { writes: ['Raumbuch.xlsx'], attempt: 1 }

describe('fileWork', () => {
  test('a file the run wrote but that was not kept is a failure with its reason, never „Erstellt“', () => {
    const [work] = fileWork(
      [run('a', { ...making, status: 'ok', made: [], failed: ['Raumbuch.xlsx'], failed_reasons: ['too_large'] })],
      false
    )
    expect(work).toMatchObject({ file: 'Raumbuch.xlsx', outcome: 'failed', failedKind: 'make', failedReason: 'too_large' })
    expect(work.phases.map((phase) => [phase.kind, phase.state])).toEqual([['make', 'failed']])
  })

  test('the final row names the files the run kept and the ones it did not', () => {
    const works = fileWork(
      [
        run('a', {
          writes: ['….xlsx'],
          status: 'ok',
          made: ['Raumbuch.xlsx'],
          failed: ['Plan.pdf'],
          failed_reasons: ['not_written'],
        }),
      ],
      false
    )
    expect(works.map((work) => [work.file, work.outcome, work.failedReason])).toEqual([
      ['Raumbuch.xlsx', 'made', undefined],
      ['Plan.pdf', 'failed', 'not_written'],
    ])
  })

  test('a file made on the first try is one row: prepared, made', () => {
    const [work] = fileWork(
      [skill('office-excel'), run('a', { ...making, status: 'ok', made: ['Raumbuch.xlsx'], elapsed_ms: 900 })],
      false
    )
    expect(work).toMatchObject({ file: 'Raumbuch.xlsx', format: 'excel', outcome: 'made', steps: 2 })
    expect(work.phases.map((phase) => [phase.kind, phase.state])).toEqual([
      ['prepare', 'done'],
      ['make', 'done'],
    ])
  })

  test('only the guide for its own format counts as preparing a file', () => {
    const steps = [
      skill('office-excel'),
      run('a', { writes: ['Bericht.docx'], status: 'ok', made: ['Bericht.docx'] }),
      skill('execute'),
      run('b', { writes: ['Plan.pdf'], status: 'ok', made: ['Plan.pdf'] }),
    ]
    expect(fileWork(steps, false).map((work) => work.phases[0].kind)).toEqual(['make', 'prepare'])
  })

  test('a failed attempt the agent retried is the same phase, never an error', () => {
    const steps = [
      run('a', { ...making, status: 'error' }),
      run('b', { ...making, attempt: 2, status: 'ok', made: ['Raumbuch.xlsx'] }),
    ]
    const [work] = fileWork(steps, false)
    expect(work.outcome).toBe('made')
    expect(work.phases).toEqual([{ kind: 'make', state: 'done', attempts: 2 }])
    expect(work.steps).toBe(1)
  })

  test('while the turn runs, a failed attempt still reads as working on it', () => {
    const steps = [run('a', { ...making, status: 'error' })]
    expect(fileWork(steps, true)[0]).toMatchObject({ outcome: 'running', attempts: 1 })
    const retrying = [...steps, run('b', { ...making, attempt: 2 }, { complete: false })]
    expect(fileWork(retrying, true)[0]).toMatchObject({ outcome: 'running', attempts: 2 })
  })

  test('the last attempt failing when the answer settles is a failure of that phase', () => {
    const steps = [run('a', { ...making, status: 'error' }), run('b', { ...making, status: 'timeout' })]
    expect(fileWork(steps, false)[0]).toMatchObject({ outcome: 'failed', failedKind: 'make' })
  })

  test('a run that never finished is a failure once the turn is over', () => {
    expect(fileWork([run('a', making, { complete: false })], false)[0].outcome).toBe('failed')
  })

  test('an existing file rewritten is an edit, a read back is a check', () => {
    const steps = [
      run('a', { writes: ['Raumbuch.xlsx'], editing: ['Raumbuch.xlsx'], status: 'ok', changed: ['Raumbuch.xlsx'] }),
      run('b', { reads: ['Raumbuch.xlsx'], status: 'ok', result: '12' }),
    ]
    const [work] = fileWork(steps, false)
    expect(work.outcome).toBe('edited')
    expect(work.phases.map((phase) => phase.kind)).toEqual(['edit', 'check'])
  })

  test('a run with no file is a calculation with its result and inputs', () => {
    const [work] = fileWork(
      [
        run('a', {
          status: 'ok',
          result: '{"summe": 92.87}',
          documents: ['Raumliste.xlsx', 'Plan.pdf'],
          document_ids: ['doc-1', ''],
        }),
      ],
      false
    )
    expect(work).toMatchObject({ outcome: 'calculated', result: '{"summe": 92.87}' })
    expect(work.file).toBeUndefined()
    expect(work.documents).toEqual([{ name: 'Raumliste.xlsx', documentId: 'doc-1' }, { name: 'Plan.pdf' }])
  })

  test('several files in one turn are one row each, in the order they appeared', () => {
    const steps = [
      run('a', { writes: ['a.docx', 'b.pdf'], status: 'ok', made: ['a.docx', 'b.pdf'] }),
      run('c', { status: 'ok', result: '3' }),
      run('d', { writes: ['Raumbuch.xlsx'], status: 'ok', made: ['Raumbuch.xlsx'] }),
    ]
    expect(fileWork(steps, false).map((work) => [work.file ?? 'calc', work.outcome])).toEqual([
      ['a.docx', 'made'],
      ['b.pdf', 'made'],
      ['calc', 'calculated'],
      ['Raumbuch.xlsx', 'made'],
    ])
  })

  test('the stored turn reads the same as the live one', () => {
    const steps = storedSteps([
      {
        id: 'status:file-run:x',
        kind: 'status',
        slot: 'file-run:x',
        key: 'status.action.fileMake',
        values: { file: 'Raumbuch.xlsx', format: 'xlsx' },
        detail: { writes: ['Raumbuch.xlsx'], attempt: 1, status: 'ok', made: ['Raumbuch.xlsx'], elapsed_ms: 40 },
      },
    ])
    expect(fileRuns(steps)[0]).toMatchObject({ status: 'ok', made: ['Raumbuch.xlsx'], elapsedMs: 40 })
  })
})

describe('the live line names the file, never the code', () => {
  test.each([
    ['status.action.fileMake', { file: 'Raumbuch.xlsx', format: 'xlsx' }, 'Excel-Tabelle wird erstellt: Raumbuch.xlsx …', 'Making the Excel workbook: Raumbuch.xlsx …'],
    ['status.action.fileEdit', { file: 'Raumbuch.xlsx', format: 'xlsx' }, 'Raumbuch.xlsx wird überarbeitet …', 'Revising Raumbuch.xlsx …'],
    ['status.action.fileCheck', { file: 'Bericht.docx', format: 'docx' }, 'Bericht.docx wird geprüft …', 'Checking Bericht.docx …'],
    ['status.action.fileRetry', { file: 'Bericht.docx', format: 'docx' }, 'Word-Dokument wird erstellt: Bericht.docx – noch ein Versuch …', 'Making the Word document: Bericht.docx – trying once more …'],
    ['status.action.filesMake', { count: '2' }, '2 Dateien werden erstellt …', 'Making 2 files …'],
    ['status.action.calculation', {}, 'Rechnet …', 'Calculating …'],
  ])('%s', (key, values, de, en) => {
    const steps = [run('a', {}, { complete: false, key, values })]
    expect(liveLine(steps, tDe)).toBe(de)
    expect(liveLine(steps, tEn)).toBe(en)
  })

  test('no live line in either language says code, script or sandbox', () => {
    for (const key of ['codeRun', 'fileMake', 'filesMake', 'fileEdit', 'fileCheck', 'fileRetry', 'calculation']) {
      for (const t of [tDe, tEn]) {
        const text = t(`thinking.turnStatus.status.action.${key}`, { file: 'a.pdf', format: 'PDF', count: 2 })
        expect(text).not.toMatch(/code|skript|script|javascript|sandbox|isolat/i)
      }
    }
  })
})

describe('resultText', () => {
  test('numbers are written the office way', () => {
    expect(resultText('{"summe": 92.87}', 'de')).toBe('summe 92,87')
    expect(resultText('1234.5', 'de')).toBe('1.234,5')
    expect(resultText('1234.5', 'en')).toBe('1,234.5')
    expect(resultText('fertig', 'de')).toBe('fertig')
  })
})
