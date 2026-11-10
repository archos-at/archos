import 'server-only'
import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { SCREENED_ONLY, documentVisibleTo } from '@/lib/documents/visibility'

/** Which kinds of model file a turn's project holds: what the agent's measuring tools can read. */
export interface ProjectModelKinds {
  ifc: boolean
  dxf: boolean
}

/**
 * Whether the project, the office shelf or this conversation's own uploads hold
 * an IFC or a DXF the agent may read (`SCREENED_ONLY`, the reader its tools read
 * through). Read off the documents, not `bim_models`, so an IFC whose extraction
 * has not started yet still counts. The agent binds `ifc_query`, `ifc_measure`
 * and `dxf_measure` only where this says there is one: their schemas are ~9k
 * tokens of every call of a turn (the chat agent's `turn_tools.py`).
 */
export async function projectModelKinds(
  organizationId: string,
  projectId: string,
  conversationId: string | null,
): Promise<ProjectModelKinds> {
  const db = getDb()
  const thisConversation: SQL | undefined = conversationId
    ? and(eq(documents.scope, 'session'), eq(documents.conversationId, conversationId))
    : undefined
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({
        ifc: sql<boolean>`coalesce(bool_or(lower(${documents.filename}) like '%.ifc'), false)`,
        dxf: sql<boolean>`coalesce(bool_or(lower(${documents.filename}) like '%.dxf'), false)`,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          or(eq(documents.projectId, projectId), eq(documents.scope, 'office_shelf'), thisConversation),
          documentVisibleTo(SCREENED_ONLY),
        ),
      ),
  )
  // A raw `sql<boolean>` is what the driver returns; coerce at the boundary.
  return { ifc: row?.ifc === true, dxf: row?.dxf === true }
}
