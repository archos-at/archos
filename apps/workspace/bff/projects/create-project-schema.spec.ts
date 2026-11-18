/**
 * @vitest-environment node
 *
 * The body of `POST /api/projects`: the agent sets a project up unless the person
 * says otherwise, and every new field has its bound.
 */
import { describe, expect, it } from 'vitest'
import type { GeocodeResult } from '@/lib/geocoding/types'
import { createProjectSchema, isAgentSetup } from './create-project-schema'
import { LEGACY_AGENT_SETUP } from './legacy-project-setup'

const location: GeocodeResult = {
  label: 'Hauptstraße 12, 1010 Wien',
  lat: 48.2,
  lon: 16.37,
  country: 'at',
  federalState: 'vienna',
  state: 'Wien',
  municipality: 'Wien',
  postcode: '1010',
  kind: 'address',
}

describe('createProjectSchema', () => {
  it('defaults the setup to the agent', () => {
    expect(createProjectSchema.parse({ name: 'Haus' })).toEqual({ name: 'Haus', setup: 'agent' })
  })

  it('accepts the agent setup under its new name, and both names mean the agent', () => {
    expect(createProjectSchema.parse({ name: 'Haus', setup: 'agent' })).toEqual({ name: 'Haus', setup: 'agent' })
    expect(isAgentSetup('agent')).toBe(true)
    expect(isAgentSetup(LEGACY_AGENT_SETUP)).toBe(true)
    expect(isAgentSetup('self')).toBe(false)
    expect(isAgentSetup(undefined)).toBe(false)
  })

  it('accepts self, a description, a location and a Bundesland', () => {
    const body = createProjectSchema.parse({
      name: ' Haus ',
      setup: 'self',
      description: '  Aufstockung  ',
      location,
      federalState: 'tyrol',
    })
    expect(body).toEqual({ name: 'Haus', setup: 'self', description: 'Aufstockung', location, federalState: 'tyrol' })
  })

  it('still reads `bundesland` from a tab that has not reloaded (remove after one release)', () => {
    expect(createProjectSchema.parse({ name: 'Haus', bundesland: 'tirol' })).toEqual({
      name: 'Haus',
      setup: 'agent',
      federalState: 'tyrol',
    })
    expect(createProjectSchema.parse({ name: 'Haus', bundesland: 'tirol', federalState: 'vienna' })).toMatchObject({
      federalState: 'vienna',
    })
  })

  it('treats a blank description as none', () => {
    expect(createProjectSchema.parse({ name: 'Haus', description: '   ' }).description).toBeUndefined()
  })

  it('refuses a description over 500 characters, after trimming', () => {
    expect(createProjectSchema.safeParse({ name: 'Haus', description: 'a'.repeat(500) }).success).toBe(true)
    expect(createProjectSchema.safeParse({ name: 'Haus', description: 'a'.repeat(501) }).success).toBe(false)
  })

  it('refuses an unknown setup, a location outside Austria, an unknown Bundesland and stray fields', () => {
    expect(createProjectSchema.safeParse({ name: 'Haus', setup: 'wizard' }).success).toBe(false)
    expect(createProjectSchema.safeParse({ name: 'Haus', location: { ...location, country: 'de' } }).success).toBe(false)
    expect(createProjectSchema.safeParse({ name: 'Haus', federalState: 'bayern' }).success).toBe(false)
    expect(createProjectSchema.safeParse({ name: 'Haus', extra: 1 }).success).toBe(false)
  })

  it('keeps the closing as before', () => {
    const body = createProjectSchema.parse({
      name: 'Alt',
      closing: { outcome: 'completed', endedOn: '2022-08', startedOn: null },
    })
    expect(body.closing).toEqual({ outcome: 'completed', endedOn: '2022-08', startedOn: null })
    expect(createProjectSchema.safeParse({ name: 'Alt', closing: { outcome: 'completed', endedOn: '2022-8', startedOn: null } }).success).toBe(false)
  })
})
