/**
 * Who sees the platform's skills (ADR-0160, ADR-0170): the platform's own
 * catalog, on the platform door only. Publishing, editing and deleting run on
 * the person's own yes (`personDecides` in `catalog/platform-skills.ts`).
 */

import type { platformSkillOperations } from '../catalog/platform-skills'
import { PLATFORM_PUBLIC, type PlatformExposure } from './platform'

type PlatformSkillOperationName = (typeof platformSkillOperations)[number]['name']

export const PLATFORM_SKILL_EXPOSURE = {
  'platform-skill-create': PLATFORM_PUBLIC,
  'platform-skill-delete': PLATFORM_PUBLIC,
  'platform-skill-list': PLATFORM_PUBLIC,
  'platform-skill-update': PLATFORM_PUBLIC,
} as const satisfies Record<PlatformSkillOperationName, PlatformExposure>
