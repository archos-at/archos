import { evaluateIntakeConditions } from './intake-conditions'
import type { ProjectIntakeCondition, ProjectIntakeScope } from './intake-types'
import type { ProjectPrimitiveValue } from './types'

export const DOCUMENT_ROLES = [
  'development_plan',
  'zoning_plan',
  'land_register_extract',
  'site_plan',
  'existing_plans',
  'existing_photos',
  'expert_report_ground',
  'expert_report_noise',
  'expert_report_pollutants',
  'preliminary_design_study',
  'authority_correspondence',
  'preliminary_decision',
  'other_project_basis',
] as const

export type DocumentRole = (typeof DOCUMENT_ROLES)[number]

export const LEGACY_DOCUMENT_ROLES: Readonly<Record<string, DocumentRole>> = {
  bebauungsplan: 'development_plan',
  flaechenwidmungsplan: 'zoning_plan',
  grundbuchauszug: 'land_register_extract',
  lageplan: 'site_plan',
  bestandsplan: 'existing_plans',
  foto_bestand: 'existing_photos',
  gutachten_baugrund: 'expert_report_ground',
  gutachten_laerm: 'expert_report_noise',
  gutachten_schadstoffe: 'expert_report_pollutants',
  vorentwurf_studie: 'preliminary_design_study',
  behoerdenkorrespondenz: 'authority_correspondence',
  vorbescheid: 'preliminary_decision',
  sonstige_projektgrundlage: 'other_project_basis',
}

export const canonicalDocumentRole = (value: unknown): unknown =>
  typeof value === 'string' ? (LEGACY_DOCUMENT_ROLES[value] ?? value) : value

export type RoleCardinality = 'one' | 'many'

export interface DocumentRoleDefinition {
  role: DocumentRole
  label: string
  scope: ProjectIntakeScope
  cardinality: RoleCardinality
  recommendedWhen?: ProjectIntakeCondition[]
  why?: string
}

export const DOCUMENT_ROLE_DEFINITIONS: readonly DocumentRoleDefinition[] = [
  {
    role: 'development_plan',
    label: 'Bebauungsplan',
    scope: 'plot',
    cardinality: 'one',
    recommendedWhen: [{ param: 'B2', op: 'equals', value: 'yes' }],
    why: 'Grundlage für Bauklasse, Bebauungsweise, Dichte und Fluchtlinien.',
  },
  {
    role: 'zoning_plan',
    label: 'Flächenwidmungsplan',
    scope: 'plot',
    cardinality: 'one',
    why: 'Zeigt, ob die geplante Nutzung am Standort grundsätzlich möglich ist.',
  },
  {
    role: 'land_register_extract',
    label: 'Grundbuchauszug',
    scope: 'plot',
    cardinality: 'one',
  },
  {
    role: 'site_plan',
    label: 'Lageplan',
    scope: 'plot',
    cardinality: 'one',
  },
  {
    role: 'existing_plans',
    label: 'Bestandspläne',
    scope: 'building',
    cardinality: 'many',
    recommendedWhen: [{ param: 'C2', op: 'equals', value: 'existing' }],
    why: 'Grundrisse, Schnitte und Ansichten. Ohne sie bleibt der Vergleich von Bestand und Zielzustand eine Schätzung.',
  },
  {
    role: 'existing_photos',
    label: 'Fotos / Bestandsaufnahme',
    scope: 'building',
    cardinality: 'many',
    recommendedWhen: [{ param: 'C2', op: 'equals', value: 'existing' }],
  },
  {
    role: 'expert_report_ground',
    label: 'Baugrundgutachten',
    scope: 'plot',
    cardinality: 'many',
  },
  {
    role: 'expert_report_noise',
    label: 'Lärmgutachten',
    scope: 'plot',
    cardinality: 'many',
    why: 'Liefert die Pegel, die der Wizard bewusst nicht abfragt.',
  },
  {
    role: 'expert_report_pollutants',
    label: 'Schadstoffgutachten',
    scope: 'project',
    cardinality: 'many',
    recommendedWhen: [{ param: 'A5', op: 'includes_any', value: ['demolition'] }],
  },
  {
    role: 'preliminary_design_study',
    label: 'Vorentwürfe & Studien',
    scope: 'project',
    cardinality: 'many',
  },
  {
    role: 'authority_correspondence',
    label: 'Behördenkorrespondenz',
    scope: 'project',
    cardinality: 'many',
  },
  {
    role: 'preliminary_decision',
    label: 'Vorbescheid',
    scope: 'project',
    cardinality: 'many',
  },
  {
    role: 'other_project_basis',
    label: 'Sonstige Projektgrundlagen',
    scope: 'project',
    cardinality: 'many',
  },
]

export const ROLE_CONFIDENCES = ['declared', 'suggested'] as const
export type RoleConfidence = (typeof ROLE_CONFIDENCES)[number]

export const ROLE_SOURCES = ['user', 'wizard', 'classifier'] as const
export type RoleSource = (typeof ROLE_SOURCES)[number]

const DEFINITION_BY_ROLE: ReadonlyMap<DocumentRole, DocumentRoleDefinition> = new Map(
  DOCUMENT_ROLE_DEFINITIONS.map((definition) => [definition.role, definition])
)

export function isDocumentRole(value: string): value is DocumentRole {
  return DEFINITION_BY_ROLE.has(value as DocumentRole)
}

export function isRoleConfidence(value: string): value is RoleConfidence {
  return (ROLE_CONFIDENCES as readonly string[]).includes(value)
}

export function isRoleSource(value: string): value is RoleSource {
  return (ROLE_SOURCES as readonly string[]).includes(value)
}

export function documentRoleDefinition(role: DocumentRole): DocumentRoleDefinition {
  const definition = DEFINITION_BY_ROLE.get(role)
  if (!definition) throw new Error(`Unknown document role: ${role}`)
  return definition
}

export function documentRoleLabel(role: DocumentRole): string {
  return documentRoleDefinition(role).label
}

export function roleRequiresScopeInstance(role: DocumentRole): boolean {
  return documentRoleDefinition(role).scope === 'building'
}

export function isScopeInstanceValid(role: DocumentRole, scopeInstanceId: string | null): boolean {
  const required = roleRequiresScopeInstance(role)
  if (required) return typeof scopeInstanceId === 'string' && scopeInstanceId.length > 0
  return scopeInstanceId === null
}

export function recommendedRoles(
  answers: Record<string, ProjectPrimitiveValue>,
  instanceId?: string
): DocumentRole[] {
  return DOCUMENT_ROLE_DEFINITIONS.filter(
    (definition) =>
      definition.recommendedWhen !== undefined &&
      evaluateIntakeConditions(definition.recommendedWhen, answers, instanceId)
  ).map((definition) => definition.role)
}
