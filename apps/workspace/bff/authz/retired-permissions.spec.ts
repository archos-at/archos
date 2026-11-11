/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { ALL_PERMISSION_SPECS, ROLES } from './catalog'
import { RETIRED_PERMISSIONS } from './retired-permissions'

describe('retired permissions', () => {
  it('names no permission the catalog declares or a role holds', () => {
    // The provisioning script would create it and then delete it, every deploy.
    const live = new Set([
      ...ALL_PERMISSION_SPECS.map((permission) => permission.slug),
      ...ROLES.flatMap((role) => role.permissions),
    ])
    expect(RETIRED_PERMISSIONS.filter((permission) => live.has(permission.slug))).toEqual([])
  })

  it('names each slug once, in a namespace the provisioning check watches, with what retired it', () => {
    const slugs = RETIRED_PERMISSIONS.map((permission) => permission.slug)
    expect(slugs).toEqual([...new Set(slugs)])
    for (const permission of RETIRED_PERMISSIONS) {
      expect(permission.slug).toMatch(/^(org|platform|project|skill|folder|workflow):/)
      expect(permission.retiredBy).toMatch(/ADR-\d{4}|#\d+/)
    }
  })
})
