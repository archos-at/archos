export const CONVERSATION_TAG_KEYS = [
  'fire_safety',
  'sound_insulation',
  'accessibility',
  'energy',
  'structural',
  'hygiene',
  'safety_in_use',
  'general',
] as const

export type ConversationTagKey = (typeof CONVERSATION_TAG_KEYS)[number]

const TAG_KEY_SET: ReadonlySet<string> = new Set(CONVERSATION_TAG_KEYS)

export const LEGACY_CONVERSATION_TAG_KEYS: Readonly<Record<string, ConversationTagKey>> = {
  brandschutz: 'fire_safety',
  schallschutz: 'sound_insulation',
  barrierefreiheit: 'accessibility',
  energie: 'energy',
  statik: 'structural',
  nutzungssicherheit: 'safety_in_use',
  allgemein: 'general',
}

export const canonicalConversationTagKey = (value: string): string => LEGACY_CONVERSATION_TAG_KEYS[value] ?? value

export function isConversationTagKey(value: string): value is ConversationTagKey {
  return TAG_KEY_SET.has(value)
}

export function normalizeConversationTags(values: readonly string[]): ConversationTagKey[] {
  const seen = new Set<ConversationTagKey>()
  for (const value of values) {
    const key = canonicalConversationTagKey(value.trim().toLowerCase())
    if (isConversationTagKey(key)) seen.add(key)
  }
  return [...seen]
}
