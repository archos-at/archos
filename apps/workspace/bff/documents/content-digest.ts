import 'server-only'
import { createHash } from 'node:crypto'

export const CONTENT_DIGEST_ALGORITHM = 'sha256'

export function contentDigest(bytes: Buffer | Uint8Array): string {
  return `${CONTENT_DIGEST_ALGORITHM}:${createHash(CONTENT_DIGEST_ALGORITHM).update(bytes).digest('hex')}`
}
