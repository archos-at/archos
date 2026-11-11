/**
 * The site's leaf from a project's profile (design §5.5 step 1, ADR-0173):
 * the register's municipality first (`site_territory`, written by
 * `project-site-set`, ADR-0172), then the stated Land, then the stated
 * country. A confirmed fact is `verified`; an assumption places the project
 * only `unverified`. Nothing places a project by default: no fact is no leaf,
 * and the gate reads `site_unknown` (ADR-0158). Pure.
 */

import { FEDERAL_STATE_TERRITORIES } from '../office/reading'
import type { SiteLeaf } from './resolve'

type Entry = { value?: unknown } | undefined
interface ProfileSiteEntries {
  facts?: Readonly<Record<string, Entry>>
  assumptions?: Readonly<Record<string, Entry>>
}

/** A frozen territory id the register wrote: `AT:gkz:60101`, `AT-9`, `DE`. */
const TERRITORY_ID = /^[A-Z]{2}(?:-[A-Z0-9]{1,3}|:[a-z]{2,8}:[A-Za-z0-9]{1,20})?$/

function leafOf(entries: Readonly<Record<string, Entry>>): string | null {
  const territory = entries.site_territory?.value
  if (typeof territory === 'string' && TERRITORY_ID.test(territory)) return territory
  const state = entries.federal_state?.value
  if (typeof state === 'string' && FEDERAL_STATE_TERRITORIES[state]) return FEDERAL_STATE_TERRITORIES[state]
  const country = entries.country?.value
  if (typeof country === 'string' && /^[a-z]{2}$/.test(country)) return country.toUpperCase()
  return null
}

/** The site's leaves: at most one today, the confirmed one before an assumed one. */
export function siteLeaves(profile: ProfileSiteEntries | null | undefined): SiteLeaf[] {
  const confirmed = leafOf(profile?.facts ?? {})
  if (confirmed) return [{ territoryId: confirmed, certainty: 'verified' }]
  const assumed = leafOf(profile?.assumptions ?? {})
  return assumed ? [{ territoryId: assumed, certainty: 'unverified' }] : []
}
