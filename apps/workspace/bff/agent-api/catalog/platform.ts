import type { AgentOperation } from '../operation'
import { platformBaseCorpusOperations } from './platform-base-corpus'
import { platformCardListOperations } from './platform-card-list'
import { platformFleetSettingsOperations } from './platform-fleet-settings'
import { platformLessonOperations } from './platform-lessons'
import { platformMaintenanceOperations } from './platform-maintenance'
import { platformNormOperations } from './platform-norms'
import { platformOrganizationOperations } from './platform-organizations'
import { platformProductFeedbackOperations } from './platform-product-feedback'
import { platformQualityOperations } from './platform-quality'
import { platformSkillCategoryOperations } from './platform-skill-categories'

export const platformOperations = [
  ...platformOrganizationOperations,
  ...platformFleetSettingsOperations,
  ...platformNormOperations,
  ...platformSkillCategoryOperations,
  ...platformLessonOperations,
  ...platformProductFeedbackOperations,
  ...platformQualityOperations,
  ...platformCardListOperations,
  ...platformBaseCorpusOperations,
  ...platformMaintenanceOperations,
] as const satisfies readonly AgentOperation[]
