/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { procedureFromProfile, profileHasProcedure } from './profile-procedure'

const fact = (value: unknown) => ({ value })

describe('procedureFromProfile', () => {
  it('reads the procedure’s scoped facts (positive control)', () => {
    const facts = {
      'procedure_type@p1': fact('building_permit'),
      'filed_on@p1': fact('2023-06-01'),
      'decided_on@p1': fact('pending'),
      'filed_on@p2': fact('2020-01-01'),
    }
    expect(procedureFromProfile(facts, 'p1')).toEqual({
      procedureType: 'building_permit',
      filedOn: '2023-06-01',
      decidedOn: 'pending',
      worksStartedOn: null,
    })
    expect(procedureFromProfile(facts, 'p2').filedOn).toBe('2020-01-01')
  })

  it('reads a malformed value as unknown, never as a date', () => {
    const facts = { 'filed_on@p1': fact('01.06.2023'), 'decided_on@p1': fact(true) }
    expect(procedureFromProfile(facts, 'p1')).toMatchObject({ filedOn: null, decidedOn: null })
  })

  it('knows whether the profile names the procedure', () => {
    expect(profileHasProcedure({ 'filed_on@p1': fact('2023-06-01') }, 'p1')).toBe(true)
    expect(profileHasProcedure({ 'filed_on@p1': fact('2023-06-01') }, 'p2')).toBe(false)
  })
})
