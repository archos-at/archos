import 'server-only'
import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { SCREENED_ONLY, documentVisibleTo } from '@/lib/documents/visibility'
import { DRAWING_RENDITION_EXTENSIONS } from '@/lib/documents/preview-types'
import { IFC_EXTENSIONS } from './types'

export interface ProjectModelKinds {
  ifc: boolean
  dxf: boolean
}

function endsWithAny(extensions: readonly string[]): SQL {
  return or(...extensions.map((ext) => sql`lower(btrim(${documents.filename})) LIKE ${`%${ext}`}`)) as SQL
}

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
        ifc: sql<boolean>`coalesce(bool_or(${endsWithAny(IFC_EXTENSIONS)}), false)`,
        dxf: sql<boolean>`coalesce(bool_or(${endsWithAny(DRAWING_RENDITION_EXTENSIONS)}), false)`,
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
  return { ifc: row?.ifc === true, dxf: row?.dxf === true }
}
