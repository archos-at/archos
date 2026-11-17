// @disk-inputs: ../../tests/fixtures/citation_pipeline/wire_sources.json
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { citationFromWire } from './wire-citation'
import type { WireCitationSource } from '../types'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = resolve(HERE, '../../../../../../tests/fixtures/citation_pipeline')
const WIRE_SOURCES = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, 'wire_sources.json'), 'utf-8')
) as WireCitationSource[]

describe('the binding status the backend actually emits', () => {
  test('the fixture still carries the field, on every source', () => {
    expect(WIRE_SOURCES.length).toBe(2)
    for (const source of WIRE_SOURCES) {
      expect(typeof source.binding_status, JSON.stringify(source.file_name)).toBe('string')
    }
  })

  test('a guideline the backend classified arrives as its classification', () => {
    const [oib] = WIRE_SOURCES
    expect(oib.file_name).toBe('oib-rl_2_ausgabe_mai_2023.pdf')
    expect(oib.binding_status).toBe('declared_binding')
    expect(citationFromWire(oib).bindingStatus).toBe('declared_binding')
  })

  test("the backend's own `unknown` becomes no pill at all", () => {
    const [, projekt] = WIRE_SOURCES
    expect(projekt.file_name).toBe('einreichplan_og.pdf')
    expect(projekt.binding_status).toBe('unknown')
    expect(citationFromWire(projekt).bindingStatus).toBeUndefined()
  })

  test('nothing else on the source is disturbed by dropping the status', () => {
    const citation = citationFromWire(WIRE_SOURCES[1])
    expect(citation.bindingStatus).toBeUndefined()
    expect([citation.fileName, citation.page, citation.lane]).toEqual([
      'einreichplan_og.pdf',
      4,
      'project',
    ])
  })
})
