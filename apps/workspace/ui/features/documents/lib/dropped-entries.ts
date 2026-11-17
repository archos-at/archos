export interface DroppedFile {
  file: File
  relativePath?: string
}

export interface DroppedTree {
  files: DroppedFile[]
  truncated: boolean
  loose: File[]
  unreadable: number
  unreadableRoots: string[]
}

export interface DroppedFiles {
  files: File[]
  truncated: boolean
  unreadable: number
}

const SKIPPED_DIRECTORIES = new Set(['@eadir', '#recycle', '#snapshot', '.git', '.svn', '__macosx', '.dropbox.cache', '.trash', '.trashes', '$recycle.bin', 'node_modules'])

const isSkippedDirectory = (name: string): boolean => SKIPPED_DIRECTORIES.has(name.toLowerCase())

const MAX_FILES = 2000
const MAX_DEPTH = 12
const MAX_MILLISECONDS = 20_000

interface FileSystemEntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath?: string
  file?: (onSuccess: (file: File) => void, onError: (error: unknown) => void) => void
  createReader?: () => {
    readEntries: (
      onSuccess: (entries: FileSystemEntryLike[]) => void,
      onError: (error: unknown) => void
    ) => void
  }
}

const entryFile = (entry: FileSystemEntryLike): Promise<File | null> =>
  new Promise((resolve) => {
    if (!entry.file) return resolve(null)
    entry.file(
      (file) => resolve(file),
      () => resolve(null)
    )
  })

const readAllEntries = async (entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> => {
  const reader = entry.createReader?.()
  if (!reader) return []
  const all: FileSystemEntryLike[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([])
      )
    })
    if (batch.length === 0) return all
    all.push(...batch)
    if (all.length > MAX_FILES) return all
  }
}

export async function readDroppedTree(dataTransfer: DataTransfer): Promise<DroppedTree | null> {
  const items = dataTransfer.items
  if (!items || items.length === 0) return null

  const roots: FileSystemEntryLike[] = []
  const loose: File[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item?.kind !== 'file') continue
    const getEntry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry
    const entry = getEntry?.call(item)
    if (entry) {
      roots.push(entry)
      continue
    }
    const file = item.getAsFile?.()
    if (file) loose.push(file)
  }
  if (roots.length === 0) return null

  const startedAt = Date.now()
  const files: DroppedFile[] = []
  let truncated = false
  let unreadable = 0
  const unreadableRoots: string[] = []

  const queue: Array<{ entry: FileSystemEntryLike; path: string; depth: number }> = roots.map(
    (entry) => ({ entry, path: entry.name, depth: 0 })
  )

  while (queue.length > 0) {
    if (files.length >= MAX_FILES || Date.now() - startedAt > MAX_MILLISECONDS) {
      truncated = true
      break
    }
    const { entry, path, depth } = queue.shift()!

    if (entry.isFile) {
      const file = await entryFile(entry)
      if (file) files.push({ file, relativePath: depth > 0 ? path : undefined })
      else if (depth === 0) unreadableRoots.push(entry.name)
      else unreadable += 1
      continue
    }

    if (entry.isDirectory) {
      if (depth > 0 && isSkippedDirectory(entry.name)) continue
      if (depth >= MAX_DEPTH) {
        truncated = true
        continue
      }
      const children = await readAllEntries(entry)
      for (const child of children) {
        queue.push({ entry: child, path: `${path}/${child.name}`, depth: depth + 1 })
      }
    }
  }

  return { files, truncated, loose, unreadable, unreadableRoots }
}

export async function readDrop(dataTransfer: DataTransfer): Promise<DroppedFiles> {
  const listed = Array.from(dataTransfer.files ?? [])
  const tree = await readDroppedTree(dataTransfer)
  if (!tree) return { files: listed, truncated: false, unreadable: 0 }
  const recovered: File[] = []
  let unreadable = tree.unreadable
  for (const name of tree.unreadableRoots) {
    const file = listed.find((candidate) => candidate.name === name && !recovered.includes(candidate))
    if (file) recovered.push(file)
    else unreadable += 1
  }
  return { files: [...asPathStampedFiles(tree), ...tree.loose, ...recovered], truncated: tree.truncated, unreadable }
}

export function asPathStampedFiles(tree: DroppedTree): File[] {
  return tree.files.map(({ file, relativePath }) =>
    relativePath ? stampRelativePath(file, relativePath) : file
  )
}

export function stampRelativePath(file: File, relativePath: string): File {
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relativePath,
      configurable: true,
    })
  } catch {
    // A File implementation that refuses the definition costs the origin
  }
  return file
}
