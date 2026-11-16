import { describe, expect, it } from 'vitest'
import { DOCUMENT_READ_FAMILIES, KNOWN_DOCUMENT_STATUSES, documentReadFamily, documentStatusFacts } from './document-status'
import {
  SURFACE_STATES,
  readFamilyOfState,
  stateOfReadFamily,
  surfaceStateOf,
  surfaceStateVariant,
} from './surface-state'

describe('surfaceStateOf', () => {
  it.each(KNOWN_DOCUMENT_STATUSES)('%s is counted in the family its state names', (status) => {
    expect(readFamilyOfState(surfaceStateOf(status))).toBe(documentReadFamily(status))
  })

  it.each(KNOWN_DOCUMENT_STATUSES)('%s is drawn in the colour it declares', (status) => {
    expect(surfaceStateVariant(surfaceStateOf(status))).toBe(documentStatusFacts(status)?.variant)
  })

  it('says the bytes are still arriving, not that they are being read', () => {
    expect(surfaceStateOf('uploading')).toBe('uploading')
    expect(surfaceStateOf('UPLOADING')).toBe('uploading')
    expect(readFamilyOfState('uploading')).toBe('reading')
    expect(surfaceStateVariant('uploading')).toBe('info')
  })

  it('names each spelling of a state with one word', () => {
    expect(surfaceStateOf('ready')).toBe('citable')
    expect(surfaceStateOf('ingested')).toBe('citable')
    expect(surfaceStateOf('pending')).toBe('reading')
    expect(surfaceStateOf('processing')).toBe('reading')
    expect(surfaceStateOf('quarantined')).toBe('held')
    expect(surfaceStateOf('error')).toBe('unreadable')
    expect(surfaceStateOf('uploaded')).toBe('stored')
    expect(surfaceStateOf('cancelled')).toBe('cancelled')
  })

  it('calls an undeclared status unknown, never citable', () => {
    expect(surfaceStateOf('quasi-ready')).toBe('unknown')
    expect(surfaceStateOf(null)).toBe('unknown')
    expect(surfaceStateOf('')).toBe('unknown')
  })

  it('reads the status the way the column writes it', () => {
    expect(surfaceStateOf('READY')).toBe('citable')
  })

  it('reads the status alone, as the SQL that counts the families does', () => {
    expect(surfaceStateOf('failed')).toBe('unreadable')
    expect(surfaceStateVariant(surfaceStateOf('quarantined'))).toBe('warning')
  })
})

describe('families and states', () => {
  it.each(DOCUMENT_READ_FAMILIES)('the %s family round-trips through its state', (family) => {
    expect(readFamilyOfState(stateOfReadFamily(family))).toBe(family)
  })

  it('folds unknown and uploading into reading, as the SQL counts them', () => {
    expect(readFamilyOfState('unknown')).toBe('reading')
    expect(readFamilyOfState('uploading')).toBe('reading')
    expect(documentReadFamily('uploading')).toBe('reading')
    expect(documentReadFamily('quasi-ready')).toBe('reading')
  })

  it('lists every state once', () => {
    expect(new Set(SURFACE_STATES).size).toBe(SURFACE_STATES.length)
  })
})
