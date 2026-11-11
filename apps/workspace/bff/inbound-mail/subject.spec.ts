/**
 * A held mail's subject as the list shows it: the leader chain and gateway
 * tags stripped, case and wording as sent; and whether it says „forwarded“.
 */

import { describe, expect, it } from 'vitest'
import { displaySubject, isForwardSubject, subjectWithinThread } from './subject'

describe('displaySubject', () => {
  it.each([
    ['AW: WG: AW[2]: Stellplatznachweis', 'Stellplatznachweis'],
    ['RE: Fwd: Bescheid MA 37', 'Bescheid MA 37'],
    ['[EXTERN] AW: Statik S-101', 'Statik S-101'],
    ['Extern: Re: Einladung', 'Einladung'],
    ['Antw: Protokoll (fwd)', 'Protokoll'],
    ['  Stellplatz   Nachweis ', 'Stellplatz Nachweis'],
  ])('%s → %s', (input, expected) => {
    expect(displaySubject(input)).toBe(expected)
  })

  it('keeps the case and a word that merely starts like a leader', () => {
    expect(displaySubject('Rechnung Re-Design')).toBe('Rechnung Re-Design')
    expect(displaySubject('AWS Konto')).toBe('AWS Konto')
  })

  it('is null when nothing is left', () => {
    expect(displaySubject(null)).toBeNull()
    expect(displaySubject('AW:')).toBeNull()
    expect(displaySubject('   ')).toBeNull()
  })
})

describe('isForwardSubject', () => {
  it('finds a forward leader anywhere in the chain', () => {
    expect(isForwardSubject('WG: Bescheid')).toBe(true)
    expect(isForwardSubject('AW: Fwd: Bescheid')).toBe(true)
    expect(isForwardSubject('[EXTERN] FW: Bescheid')).toBe(true)
  })

  it('is false for a reply, and for no subject', () => {
    expect(isForwardSubject('AW: Bescheid')).toBe(false)
    expect(isForwardSubject(null)).toBe(false)
  })
})

describe('subjectWithinThread', () => {
  it('keeps the part that tells a thread’s mails apart', () => {
    expect(subjectWithinThread('Stellplatznachweis – Nachreichung Statik', 'Stellplatznachweis')).toBe('Nachreichung Statik')
    expect(subjectWithinThread('stellplatznachweis: Index C', 'Stellplatznachweis')).toBe('Index C')
  })

  it('leaves a subject that only shares a prefix, or is the name alone', () => {
    expect(subjectWithinThread('Stellplatznachweise Ost', 'Stellplatznachweis')).toBe('Stellplatznachweise Ost')
    expect(subjectWithinThread('Stellplatznachweis', 'Stellplatznachweis')).toBe('Stellplatznachweis')
    expect(subjectWithinThread('Bescheid MA 37', 'Stellplatznachweis')).toBe('Bescheid MA 37')
    expect(subjectWithinThread(null, 'Stellplatznachweis')).toBeNull()
  })
})
