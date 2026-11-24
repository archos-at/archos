import { and, eq, isNull, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { projectMemory } from '@/lib/db/schema/project-memory'
import type { NewProjectMemoryItem } from '@/lib/db/schema/project-memory'

export function canonicalRestriction(
  folderIds: readonly string[] | null | undefined
): string[] | null {
  const unique = [...new Set((folderIds ?? []).map((id) => id.trim().toLowerCase()).filter(Boolean))].sort()
  return unique.length > 0 ? unique : null
}

export function arrayLiteral(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/["\\]/g, '\\$&')}"`).join(',')}}`
}

function sameRestriction(restriction: readonly string[] | null) {
  return restriction
    ? sql`${projectMemory.restrictedFolderIds} = ${arrayLiteral(restriction)}::uuid[]`
    : isNull(projectMemory.restrictedFolderIds)
}

export function memoryVisibleTo(
  readable: readonly string[] = [],
  column: AnyPgColumn = projectMemory.restrictedFolderIds
) {
  const restriction = canonicalRestriction(readable)
  return restriction
    ? sql`(${column} is null or ${column} <@ ${arrayLiteral(restriction)}::uuid[])`
    : isNull(column)
}

function memoryOwnerCondition(
  values: Pick<NewProjectMemoryItem, 'scope' | 'projectId' | 'organizationId'>
) {
  return values.scope === 'organization'
    ? and(
        eq(projectMemory.scope, 'organization'),
        eq(projectMemory.organizationId, values.organizationId),
        isNull(projectMemory.projectId)
      )
    : and(
        eq(projectMemory.scope, 'project'),
        eq(projectMemory.projectId, values.projectId as string)
      )
}

export function consolidationScope(
  values: Pick<NewProjectMemoryItem, 'scope' | 'projectId' | 'organizationId' | 'restrictedFolderIds'>
) {
  return and(memoryOwnerCondition(values), sameRestriction(canonicalRestriction(values.restrictedFolderIds)))
}
