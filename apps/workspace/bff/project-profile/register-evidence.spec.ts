import { describe, expect, it } from 'vitest'
import { addsRegisterEvidence } from './register-evidence'
import type { ProjectProfile } from './types'

const NOW = '2026-11-10T10:00:00.000Z'
const register = { kind: 'register' as const, addressId: 'at-bev:5734380', label: 'Herrengasse 16, 8010 Graz', referenceDate: '2025-10-01', resolvedAt: NOW }
const empty: ProjectProfile = { facts: {}, goals: {}, unknowns: [], assumptions: {} }
const withFact = (evidence: unknown[]): ProjectProfile => ({
  ...empty,
  facts: { municipality: { value: 'Graz', confidence: 'confirmed', source: 'user_confirmed', updatedAt: NOW, evidence: evidence as never } },
})

describe('register evidence a generic profile write may not add (ADR-0172)', () => {
  it('sees register evidence a write adds, on a fact or an alternative', () => {
    expect(addsRegisterEvidence(empty, withFact([register]))).toBe(true)
    const alternative: ProjectProfile = {
      ...empty,
      assumptions: {
        site_address: {
          value: 'x', status: 'unconfirmed', reason: '', source: 'agent_suggested', updatedAt: NOW,
          alternatives: [{ value: 'y', evidence: [register], recordedAt: NOW }],
        },
      },
    }
    expect(addsRegisterEvidence(empty, alternative)).toBe(true)
  })

  it('lets a write keep what the profile already holds, or add other evidence', () => {
    expect(addsRegisterEvidence(withFact([register]), withFact([register]))).toBe(false)
    expect(addsRegisterEvidence(empty, withFact([{ kind: 'person', userId: 'u', at: NOW }]))).toBe(false)
  })

  it('reads an entry the database stored with its keys in another order as the same one', () => {
    const reordered = { resolvedAt: NOW, referenceDate: '2025-10-01', label: register.label, kind: 'register', addressId: register.addressId }
    expect(addsRegisterEvidence(withFact([reordered]), withFact([register]))).toBe(false)
  })

  it('refuses register evidence moved to another entry, or kept under a changed value', () => {
    const moved: ProjectProfile = {
      ...empty,
      facts: { federal_state: { value: 'Graz', confidence: 'confirmed', source: 'user_confirmed', updatedAt: NOW, evidence: [register] } },
    }
    expect(addsRegisterEvidence(withFact([register]), moved)).toBe(true)
    const leoben: ProjectProfile = {
      ...empty,
      facts: { municipality: { value: 'Leoben', confidence: 'confirmed', source: 'user_confirmed', updatedAt: NOW, evidence: [register] } },
    }
    expect(addsRegisterEvidence(withFact([register]), leoben)).toBe(true)
  })

  it('refuses register evidence copied onto an alternative with another value', () => {
    const copied: ProjectProfile = {
      ...empty,
      facts: {
        municipality: {
          value: 'Graz', confidence: 'confirmed', source: 'user_confirmed', updatedAt: NOW, evidence: [register],
          alternatives: [{ value: 'Leoben', evidence: [register], recordedAt: NOW }],
        },
      },
    }
    expect(addsRegisterEvidence(withFact([register]), copied)).toBe(true)
  })

  it('lets a write drop the evidence or the entry', () => {
    expect(addsRegisterEvidence(withFact([register]), withFact([]))).toBe(false)
    expect(addsRegisterEvidence(withFact([register]), empty)).toBe(false)
  })

  it('sees an edited register entry as a new one', () => {
    expect(addsRegisterEvidence(withFact([register]), withFact([{ ...register, addressId: 'at-bev:1' }]))).toBe(true)
  })
})
