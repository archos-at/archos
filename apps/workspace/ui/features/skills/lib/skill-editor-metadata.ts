import { readMetadata, writtenMetadataKey } from '@/lib/skills/legacy-names'

export const METADATA_CARDS = 'cards'
export const METADATA_AGENTS = 'agents'
export const METADATA_HIDDEN = 'hidden'

const HIDDEN_TRUE = new Set(['true', '1', 'yes'])

export function withoutReservedKeys(metadata: Record<string, string>): Record<string, string> {
  const owned = new Set(
    ([METADATA_CARDS, METADATA_AGENTS, METADATA_HIDDEN] as const).flatMap((key) => [key, writtenMetadataKey(key)]),
  )
  const rest: Record<string, string> = {}
  for (const key of Object.keys(metadata)) {
    if (owned.has(key)) continue
    rest[key] = metadata[key]
  }
  return rest
}

export function readHidden(metadata?: Record<string, string>): boolean {
  return HIDDEN_TRUE.has((metadata ? (readMetadata(metadata, METADATA_HIDDEN) ?? '') : '').trim().toLowerCase())
}
