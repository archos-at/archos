import type { platformSkillOperations } from '../catalog/platform-skills'
import { PLATFORM_PUBLIC, type PlatformExposure } from './platform'

type PlatformSkillOperationName = (typeof platformSkillOperations)[number]['name']

export const PLATFORM_SKILL_EXPOSURE = {
  'platform-skill-create': PLATFORM_PUBLIC,
  'platform-skill-delete': PLATFORM_PUBLIC,
  'platform-skill-list': PLATFORM_PUBLIC,
  'platform-skill-update': PLATFORM_PUBLIC,
} as const satisfies Record<PlatformSkillOperationName, PlatformExposure>
