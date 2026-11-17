let held: { projectId: string; files: File[] } | null = null

export function handOverDroppedFiles(projectId: string, files: File[]): void {
  held = {
    projectId,
    files: held?.projectId === projectId ? [...held.files, ...files] : [...files],
  }
}

export function takeDroppedFiles(projectId: string): File[] {
  if (!held || held.projectId !== projectId) return []
  const { files } = held
  held = null
  return files
}

export function newProjectDropKey(): string {
  return `${NEW_PROJECT_DROP_PREFIX}${crypto.randomUUID()}`
}

const NEW_PROJECT_DROP_PREFIX = 'new-project:'
const NEW_PROJECT_DROP_KEY_PATTERN = /^new-project:[0-9a-f-]{36}$/

export function isNewProjectDropKey(value: unknown): value is string {
  return typeof value === 'string' && NEW_PROJECT_DROP_KEY_PATTERN.test(value)
}

export function discardDroppedFiles(projectId: string): void {
  if (held?.projectId === projectId) held = null
}
