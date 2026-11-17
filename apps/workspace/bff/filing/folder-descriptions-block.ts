import 'server-only'
import { folderTree, isUnderOwnList } from '@/lib/authz/folder-access-rule'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { formatBoundedDigest } from '@/lib/knowledge/digest-format'
import { maskChatText } from '@/lib/upload-screening/service'
import { listDescribedFolders } from './repository'

export const FOLDER_DESCRIPTIONS_HEADER = 'FOLDER_DESCRIPTIONS v1 (Ordner mit Beschreibung, gekürzt auf die ersten)'

export const FOLDER_DESCRIPTIONS_MAX_CHARS = 1800

const LINE_MAX_CHARS = 200

const SHELF_TAG = { project: 'Projekt', office_shelf: 'Büroablage' } as const

export async function buildFolderDescriptionsBlock(
  organizationId: string,
  projectId: string | null
): Promise<string | null> {
  const [rows, tree] = await Promise.all([
    listDescribedFolders(organizationId, projectId),
    projectId ? listProjectFolderTree(organizationId, projectId).then(folderTree) : Promise.resolve(new Map()),
  ])
  const open = rows.filter((row) => row.scope === 'office_shelf' || !isUnderOwnList(tree, row.id))
  if (open.length === 0) return null
  const items = await Promise.all(
    open.map(async (row) => {
      const { text } = await maskChatText(organizationId, row.description)
      return {
        tags: [SHELF_TAG[row.scope], row.path],
        content: text.length > LINE_MAX_CHARS ? `${text.slice(0, LINE_MAX_CHARS - 1)}…` : text,
      }
    })
  )
  return formatBoundedDigest(FOLDER_DESCRIPTIONS_HEADER, items, FOLDER_DESCRIPTIONS_MAX_CHARS)
}
