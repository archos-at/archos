import type { DocumentRole } from './document-roles'


export type ProjectIntakeQuestionType =
  | 'single_select'
  | 'multi_select'
  | 'boolean'
  | 'number'
  | 'text'
  | 'textarea'
  | 'number_tri'
  | 'yes_no_open'
  | 'upload'
  | 'document_role'
  | 'info_placeholder'

export type IntakeAnswerMode = 'value' | 'estimated' | 'open'

export type YesNoOpen = 'yes' | 'no' | 'open'

export type ProjectIntakeScope = 'project' | 'plot' | 'building'

export interface ProjectIntakeOption {
  value: string
  label: string
}

export interface ProjectIntakeCondition {
  param: string
  op: 'equals' | 'includes_any' | 'excludes_any' | 'not_empty' | 'lte'
  value?: string | string[] | number
}

export interface ProjectIntakeQuestion {
  id: string
  label: string
  type: ProjectIntakeQuestionType
  help?: string
  why?: string
  hint?: string
  unit?: string
  role?: DocumentRole
  group?: string
  core?: boolean
  kernset?: boolean
  placeholder?: string
  options?: ProjectIntakeOption[]
  conditions?: ProjectIntakeCondition[]
  writesTo?: string
  required?: boolean
  optional?: boolean
  derives?: string
  foundIn?: string[]
  feeds?: 'building_class'
}

export interface ProjectIntakeZoneDefinition {
  questions: ProjectIntakeQuestion[]
}

export interface ProjectIntakeStage {
  id: string
  title: string
  description?: string
  scope: ProjectIntakeScope
  repeatable?: boolean
  questions: ProjectIntakeQuestion[]
  zoneCommon?: ProjectIntakeQuestion[]
  zoneDefinitions?: Record<string, ProjectIntakeZoneDefinition>
}

export interface ProjectIntakeDefinition {
  version: number
  stages: ProjectIntakeStage[]
}
