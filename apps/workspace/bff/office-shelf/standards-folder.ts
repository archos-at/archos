/**
 * The office's standards live in one root folder of the office shelf, „Grundlagen
 * des Büros“, and its subfolders (ADR-0163 amendment, 2026-11). The folder is
 * the place a person files a standard, a commentary or a directive into; the
 * base-knowledge records (`knowledge_records.document_id`) still say what each
 * document is. A record whose document lies elsewhere on the shelf is still an
 * entry: the folder is where uploads land and how people sort, never what makes
 * a document base knowledge.
 *
 * Found by name at the shelf root and created on first use, as a project's
 * `Berichte` is (`getOrCreateShelfRootFolder`). That only holds while nobody
 * renames, moves or deletes it, so the office shelf's folder service refuses
 * all three for it ({@link isStandardsRoot}).
 *
 * The name is stored data, the folder's name on the shelf, so it is German.
 */

/** The root folder's name on the office shelf. */
export const STANDARDS_FOLDER_NAME = 'Grundlagen des Büros'

/** Whether a folder row is the standards root: at the shelf root, under its name. */
export function isStandardsRoot(folder: { parentId: string | null; name: string }): boolean {
  return folder.parentId === null && folder.name === STANDARDS_FOLDER_NAME
}

/** Whether a folder path is the standards root or lies below it. */
export function isUnderStandardsRoot(path: string): boolean {
  return path === STANDARDS_FOLDER_NAME || path.startsWith(`${STANDARDS_FOLDER_NAME}/`)
}

/** The refusal for a rename, move or delete of the root. English: an agent reads it. */
export const STANDARDS_ROOT_FIXED =
  'This folder holds the office’s base knowledge and keeps its name and place; rename, move or delete its subfolders instead.'
