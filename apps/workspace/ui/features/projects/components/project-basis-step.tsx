'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PRODUCT_NAME } from '@/lib/brand'
import { DOCUMENT_ROLE_DEFINITIONS, recommendedRoles } from '@/lib/project-profile/document-roles'
import type { DocumentRole } from '@/lib/project-profile/document-roles'
import type { BuildingInstance } from '@/lib/project-profile/intake-building-keys'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { DocumentRoleField } from './document-role-field'
import type { PendingRoleBind } from '../lib/pending-role-binds'

interface ProjectBasisStepProps {
  projectId: string
  answers: Record<string, ProjectPrimitiveValue>
  buildings: BuildingInstance[]
  pendingBinds?: {
    persistedBuildingIds: ReadonlySet<string>
    pending: readonly PendingRoleBind[]
    onDefer: (bind: PendingRoleBind) => void
    onDiscard: (bind: PendingRoleBind) => void
    track: (work: Promise<unknown>) => void
  }
}

type Deferral = NonNullable<Parameters<typeof DocumentRoleField>[0]['deferred']>

function deferralFor(
  slot: Slot,
  pendingBinds: ProjectBasisStepProps['pendingBinds']
): Deferral | undefined {
  const buildingId = slot.scopeInstanceId
  if (!pendingBinds || buildingId === null || pendingBinds.persistedBuildingIds.has(buildingId)) {
    return undefined
  }
  return {
    pending: pendingBinds.pending,
    onDefer: (documentId, filename) =>
      pendingBinds.onDefer({ documentId, filename, role: slot.role, scopeInstanceId: buildingId }),
    onDiscard: pendingBinds.onDiscard,
    track: pendingBinds.track,
  }
}

interface Slot {
  key: string
  role: DocumentRole
  label: string
  scopeInstanceId: string | null
  recommended: boolean
}

export function ProjectBasisStep({
  projectId,
  answers,
  buildings,
  pendingBinds,
}: ProjectBasisStepProps) {
  const slots = useMemo<Slot[]>(() => {
    const projectRecommended = new Set(recommendedRoles(answers))
    const perBuilding = new Map<string, Set<DocumentRole>>(
      buildings.map((building) => [building.id, new Set(recommendedRoles(answers, building.id))])
    )

    const collected: Slot[] = []
    for (const definition of DOCUMENT_ROLE_DEFINITIONS) {
      if (definition.scope === 'building') {
        for (const building of buildings) {
          collected.push({
            key: `${definition.role}@${building.id}`,
            role: definition.role,
            label: `${definition.label} — ${building.name}`,
            scopeInstanceId: building.id,
            recommended: perBuilding.get(building.id)?.has(definition.role) ?? false,
          })
        }
        continue
      }
      collected.push({
        key: definition.role,
        role: definition.role,
        label: definition.label,
        scopeInstanceId: null,
        recommended: projectRecommended.has(definition.role),
      })
    }
    return collected
  }, [answers, buildings])

  const recommended = slots.filter((slot) => slot.recommended)
  const optional = slots.filter((slot) => !slot.recommended)

  return (
    <div className="space-y-6">
      {recommended.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Für dieses Projekt besonders wichtig</h3>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {recommended.length === 1
                ? 'Diese Unterlage ergibt sich aus Ihren Angaben.'
                : `Diese ${recommended.length} Unterlagen ergeben sich aus Ihren Angaben.`}{' '}
              Ohne sie beantwortet {PRODUCT_NAME} Fragen dazu nur unter Vorbehalt.
            </p>
          </div>
          <ul className="space-y-3">
            {recommended.map((slot) => (
              <li key={slot.key} className="bg-card rounded-surface border px-4 py-3.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{slot.label}</span>
                  <Badge variant="info">dringend empfohlen</Badge>
                </div>
                <DocumentRoleField
                  projectId={projectId}
                  role={slot.role}
                  scopeInstanceId={slot.scopeInstanceId}
                  deferred={deferralFor(slot, pendingBinds)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {optional.length > 0 && (
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-medium">Weitere Unterlagen</h3>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Optional, und jederzeit später ergänzbar.
            </p>
          </div>
          <ul className="bg-card divide-y rounded-surface border">
            {optional.map((slot) => (
              <CollapsedSlot
                key={slot.key}
                slot={slot}
                projectId={projectId}
                deferred={deferralFor(slot, pendingBinds)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CollapsedSlot({
  slot,
  projectId,
  deferred,
}: {
  slot: Slot
  projectId: string
  deferred?: Deferral
}) {
  const [open, setOpen] = useState(false)
  const panelId = `grundlage-${slot.key.replace(/[^a-z0-9]/gi, '-')}`

  return (
    <li>
      <button data-attr="project-open"
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={panelId}
        className="hover:bg-hover flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-quick ease-out motion-reduce:transition-none"
      >
        <span className="min-w-0 flex-1 truncate text-sm">{slot.label}</span>
        {open ? (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        ) : (
          <Plus className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
      </button>
      {/* Mounted only once opened. The store means this is no longer about
          request count — it is about weight: an upload control, a picker and a
          drop zone for every one of eleven optional slots is the wall this
          collapse exists to prevent. */}
      {open && (
        <div id={panelId} className="border-t px-4 py-3.5">
          <DocumentRoleField
            projectId={projectId}
            role={slot.role}
            scopeInstanceId={slot.scopeInstanceId}
            deferred={deferred}
          />
        </div>
      )}
    </li>
  )
}
