import { projectIntakeDefinitionV1 } from './intake-definition'
import type { ProjectPrimitiveValue } from './types'

export const definition = projectIntakeDefinitionV1
export type Answers = Record<string, ProjectPrimitiveValue>
