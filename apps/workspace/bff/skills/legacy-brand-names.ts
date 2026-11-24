// drop after release 2026-W50
export const LEGACY_PLATFORM_SKILL_NAMES: Readonly<Record<string, string>> = {
  'piloti-voice': 'tone-of-voice',
  'piloti-cards': 'answer-cards',
}

export const LEGACY_METADATA_KEYS = {
  agents: 'grid-agents',
  catalog: 'grid-catalog',
  hidden: 'grid-hidden',
  cards: 'grid-cards',
  title: 'grid-title',
  execution: 'grid-execution',
  schedulable: 'grid-schedulable',
  'auto-invoke': 'grid-auto-invoke',
} as const

export type MetadataKey = keyof typeof LEGACY_METADATA_KEYS
