/**
 * The residency cell this deployment is (ADR-0167), read from `RESIDENCY_CELL`.
 *
 * Unset, residency is off and nothing here changes behaviour. Set (it is set on
 * the agent tier too, where `agent.common.residency` validates it against
 * `configs/residency/cells.yaml` and refuses to boot on an unknown cell), the
 * BFF holds the two promises that are its own: zero data retention cannot be
 * switched off, and audit events carry salted hashes instead of names.
 */

// @environment_variable RESIDENCY_CELL
// @category Workspace
// @type str
// @default (unset)
// @required false
// The residency cell this deployment is (`configs/residency/cells.yaml`, e.g. `eu-at-1`); the same value as the
// agent tier's. Set, an organization cannot switch zero data retention off and WorkOS audit events carry salted
// hashes of document and project names instead of the names (ADR-0167). Unset, nothing changes.
export function residencyCell(): string | null {
  const value = process.env.RESIDENCY_CELL?.trim()
  return value ? value : null
}
