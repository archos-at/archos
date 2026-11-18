export const STANDARDS_FOLDER_NAME = 'Grundlagen des Büros'

export function isStandardsRoot(folder: { parentId: string | null; name: string }): boolean {
  return folder.parentId === null && folder.name === STANDARDS_FOLDER_NAME
}

export function isUnderStandardsRoot(path: string): boolean {
  return path === STANDARDS_FOLDER_NAME || path.startsWith(`${STANDARDS_FOLDER_NAME}/`)
}

export const STANDARDS_ROOT_FIXED =
  'This folder holds the office’s base knowledge and keeps its name and place; rename, move or delete its subfolders instead.'
