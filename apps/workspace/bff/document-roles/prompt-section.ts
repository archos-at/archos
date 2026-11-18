import {
  documentRoleDefinition,
  DOCUMENT_ROLE_DEFINITIONS,
} from '@/lib/project-profile/document-roles'
import type { DocumentRole } from '@/lib/project-profile/document-roles'

export interface PromptRoleBinding {
  role: DocumentRole
  scopeInstanceId: string | null
  confidence: 'declared' | 'suggested'
  filename: string
  displayName: string | null
}

export type BuildingNames = Readonly<Record<string, string>>

export interface RecommendedSlot {
  role: DocumentRole
  scopeInstanceId: string | null
}

function slotKey(role: DocumentRole, scopeInstanceId: string | null): string {
  return `${role}@${scopeInstanceId ?? ''}`
}

const MAX_SLOT_LINES = 60

function label(binding: PromptRoleBinding): string {
  return binding.displayName?.trim() || binding.filename
}

function scopeSuffix(scopeInstanceId: string | null, names: BuildingNames): string {
  if (!scopeInstanceId) return ''
  return ` (${names[scopeInstanceId] ?? scopeInstanceId})`
}

interface Slot {
  role: DocumentRole
  scopeInstanceId: string | null
  bindings: PromptRoleBinding[]
}

function groupIntoSlots(bindings: readonly PromptRoleBinding[]): Slot[] {
  const byKey = new Map<string, Slot>()
  for (const definition of DOCUMENT_ROLE_DEFINITIONS) {
    for (const binding of bindings) {
      if (binding.role !== definition.role) continue
      const key = `${binding.role}@${binding.scopeInstanceId ?? ''}`
      const existing = byKey.get(key)
      if (existing) existing.bindings.push(binding)
      else
        byKey.set(key, {
          role: binding.role,
          scopeInstanceId: binding.scopeInstanceId,
          bindings: [binding],
        })
    }
  }
  return [...byKey.values()]
}

function renderSlot(slot: Slot, names: BuildingNames): string {
  const definition = documentRoleDefinition(slot.role)
  const head = `- ${definition.label}${scopeSuffix(slot.scopeInstanceId, names)}`

  if (slot.bindings.length === 1) {
    const only = slot.bindings[0]
    const unconfirmed = only.confidence === 'suggested' ? ' [nicht bestätigt]' : ''
    return `${head}: ${label(only)}${unconfirmed}`
  }

  const unconfirmed = slot.bindings.filter((binding) => binding.confidence === 'suggested').length
  const suffix = unconfirmed > 0 ? `, ${unconfirmed} davon nicht bestätigt` : ''
  return `${head}: ${slot.bindings.length} Dokumente${suffix}`
}

export function missingSlots(
  bindings: readonly Pick<PromptRoleBinding, 'role' | 'scopeInstanceId'>[],
  recommended: readonly RecommendedSlot[]
): RecommendedSlot[] {
  const bound = new Set(bindings.map((binding) => slotKey(binding.role, binding.scopeInstanceId)))
  return recommended.filter((entry) => !bound.has(slotKey(entry.role, entry.scopeInstanceId)))
}

export function buildDocumentRolesSection(
  bindings: readonly PromptRoleBinding[],
  recommended: readonly RecommendedSlot[] = [],
  buildingNames: BuildingNames = {}
): string {
  if (bindings.length === 0 && recommended.length === 0) return ''

  const slots = groupIntoSlots(bindings)
  const shown = slots.slice(0, MAX_SLOT_LINES)
  const present = shown.map((slot) => renderSlot(slot, buildingNames))

  const allMissing = missingSlots(bindings, recommended)
  const missingBudget = Math.max(0, MAX_SLOT_LINES - shown.length)
  const missing = allMissing
    .slice(0, missingBudget)
    .map(
      (entry) =>
        `- ${documentRoleDefinition(entry.role).label}${scopeSuffix(entry.scopeInstanceId, buildingNames)}`
    )

  const lines: string[] = []
  if (present.length > 0) {
    lines.push('documents:', ...present)
    const dropped = slots.length - shown.length
    if (dropped > 0) lines.push(`- (${dropped} weitere Dokumentarten nicht aufgeführt)`)
  }
  if (missing.length > 0) {
    lines.push('documents_missing:', ...missing)
    const droppedMissing = allMissing.length - missing.length
    if (droppedMissing > 0) {
      lines.push(`- (${droppedMissing} weitere fehlende Unterlagen nicht aufgeführt)`)
    }
  }
  return lines.join('\n')
}
