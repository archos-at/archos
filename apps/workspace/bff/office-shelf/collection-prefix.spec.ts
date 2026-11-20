/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as agent from '@/shared/vocabularies.generated'
import {
  OFFICE_SHELF_COLLECTION_PREFIX,
  OFFICE_SHELF_COLLECTION_PREFIXES,
  OFFICE_SHELF_TARGET_COLLECTION_PREFIX,
  isOfficeShelfCollectionName,
  officeShelfOrganizationId,
} from './collection-prefix'

describe('the office-shelf collection prefix', () => {
  it('is the same constant in TypeScript and Python', () => {
    expect([OFFICE_SHELF_TARGET_COLLECTION_PREFIX, OFFICE_SHELF_COLLECTION_PREFIX]).toEqual(agent.OFFICE_SHELF_COLLECTION_PREFIXES)
  })

  it('accepts the old and the new prefix, and nothing else', () => {
    expect(OFFICE_SHELF_COLLECTION_PREFIXES).toEqual(['office_shelf_', 'archiv_'])
    expect(isOfficeShelfCollectionName('archiv_org_1')).toBe(true)
    expect(isOfficeShelfCollectionName('office_shelf_org_1')).toBe(true)
    expect(isOfficeShelfCollectionName('proj_x')).toBe(false)
  })

  it('reads the organization id behind either prefix', () => {
    expect(officeShelfOrganizationId('archiv_org_1')).toBe('org_1')
    expect(officeShelfOrganizationId('office_shelf_org_1')).toBe('org_1')
    expect(officeShelfOrganizationId('proj_x')).toBeNull()
  })
})
