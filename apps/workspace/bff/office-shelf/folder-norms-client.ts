import type { ZodType } from 'zod'
import {
  folderNormsDecisionSchema,
  folderNormsSchema,
  type DecideFolderNormsBody,
  type FolderNorms,
  type FolderNormsDecision,
} from './folder-norms-wire'

export const folderNormsPath = (folderId: string) => `/api/office-shelf/folders/${encodeURIComponent(folderId)}/norms`

async function read<T>(schema: ZodType<T, unknown>, response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed with ${response.status}`)
  return schema.parse(await response.json())
}

export async function fetchFolderNorms(folderId: string): Promise<FolderNorms> {
  return read(folderNormsSchema, await fetch(folderNormsPath(folderId)))
}

export async function decideFolderNorms(folderId: string, body: DecideFolderNormsBody): Promise<FolderNormsDecision> {
  const response = await fetch(folderNormsPath(folderId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return read(folderNormsDecisionSchema, response)
}
