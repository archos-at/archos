import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { projectUploadScreening } from '@/lib/db/schema/project-upload-screening'
import type { ProjectScreeningOverride } from './project-policy'

export async function findProjectScreeningOverride(
  organizationId: string,
  projectId: string
): Promise<ProjectScreeningOverride | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({
        addedNameTerms: projectUploadScreening.addedNameTerms,
        removedNameTerms: projectUploadScreening.removedNameTerms,
      })
      .from(projectUploadScreening)
      .where(
        and(
          eq(projectUploadScreening.projectId, projectId),
          eq(projectUploadScreening.organizationId, organizationId)
        )
      )
      .limit(1)
  )
  return row ? { addedNameTerms: [...row.addedNameTerms], removedNameTerms: [...row.removedNameTerms] } : null
}

export async function saveProjectScreeningOverride(
  organizationId: string,
  projectId: string,
  override: ProjectScreeningOverride,
  updatedBy: string
): Promise<void> {
  const db = getDb()
  const empty = override.addedNameTerms.length === 0 && override.removedNameTerms.length === 0
  await withTenant({ organizationId }, async () => {
    if (empty) {
      await db
        .delete(projectUploadScreening)
        .where(
          and(
            eq(projectUploadScreening.projectId, projectId),
            eq(projectUploadScreening.organizationId, organizationId)
          )
        )
      return
    }
    const values = {
      addedNameTerms: override.addedNameTerms,
      removedNameTerms: override.removedNameTerms,
      updatedBy,
      updatedAt: new Date(),
    }
    await db
      .insert(projectUploadScreening)
      .values({ projectId, organizationId, ...values })
      .onConflictDoUpdate({ target: projectUploadScreening.projectId, set: values })
  })
}
