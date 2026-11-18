import type { FileItem } from '../file-types'

export function mergeById(first: readonly FileItem[], second: readonly FileItem[]): FileItem[] {
  const held = new Set(first.map((file) => file.id))
  return [...first, ...second.filter((file) => !held.has(file.id))]
}
