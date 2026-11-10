/**
 * Names in a WorkOS audit event become salted hashes inside a residency cell (ADR-0167).
 *
 * WorkOS keeps audit events in the US. A document's file name, a project's name
 * or an office's matched words say what the office works on as plainly as the
 * document does, so inside a cell they leave as an HMAC-SHA256 under
 * `AUDIT_NAME_SALT`, keyed per organization: an auditor holding a name can check
 * it against the event, and nobody reading the log learns it. Without the salt
 * the names are withheld outright (fail closed), as a restricted document's
 * already are. Outside a cell nothing changes.
 */

import { createHmac } from 'node:crypto'
import { residencyCell } from './cell'

// @environment_variable AUDIT_NAME_SALT
// @category Workspace
// @type secret
// @default (unset)
// @required false
// The key the names in WorkOS audit events are hashed under when `RESIDENCY_CELL` is set (HMAC-SHA256, per
// organization, ADR-0167). Unset inside a cell, the names are withheld. Rotating it changes every later hash.
const SALT_ENV = 'AUDIT_NAME_SALT'

/** The metadata keys whose values name a document, a project or what they hold. */
export const HASHED_NAME_KEYS = [
  'filename',
  'previousName',
  'displayName',
  'terms',
  'name',
] as const

/** The prefix a hashed name carries, so a reader can tell a hash from a name. */
export const NAME_HASH_PREFIX = 'hmac-sha256:'

type Metadata = Record<string, string | number | boolean>

export function nameHash(salt: string, organizationId: string, value: string): string {
  const digest = createHmac('sha256', salt).update(`${organizationId}\u0000${value}`).digest('hex')
  return `${NAME_HASH_PREFIX}${digest.slice(0, 32)}`
}

/** `metadata` as it may leave for WorkOS: unchanged outside a cell, names hashed or withheld inside one. */
export function residencyAuditMetadata(organizationId: string, metadata: Metadata): Metadata {
  if (residencyCell() === null) return metadata
  const salt = process.env[SALT_ENV]?.trim()
  const out: Metadata = {}
  let withheld = false
  for (const [key, value] of Object.entries(metadata)) {
    if (!(HASHED_NAME_KEYS as readonly string[]).includes(key)) {
      out[key] = value
    } else if (salt) {
      out[key] = nameHash(salt, organizationId, String(value))
    } else {
      withheld = true
    }
  }
  return withheld ? { ...out, nameWithheld: true } : out
}
