import { folderTree, isUnderOwnList } from '@/lib/authz/folder-access-rule'
import { documentTypeOf } from '@/lib/documents/tag-vocabulary'
import { folderPathKey } from '@/lib/projects/folders'
import type { OfficeFolderRow } from './repository'
import { MAX_FOLDER_DOC_TYPES, MAX_JUDGED_CONVENTIONS, type FilingConventionInput } from './types'

export const AUSTRIAN_DEFAULT_CONVENTIONS: readonly FilingConventionInput[] = [
  {
    path: 'Grundlagen',
    description: 'Vermessung, Grundbuchsauszug, Flächenwidmung, Bebauungsbestimmungen und die Unterlagen der Bauherrschaft',
    projects: 0,
    docTypes: ['Flächenwidmungsplan', 'Bebauungsplan'],
  },
  {
    path: 'Bestand',
    description: 'Bestandsunterlagen, Fotos und Gutachten zum vorhandenen Gebäude',
    projects: 0,
    docTypes: ['Foto', 'Gutachten'],
  },
  {
    path: 'Behörde und Bescheide',
    description: 'Bescheide, Stellungnahmen und Schriftverkehr mit der Baubehörde und den Amtssachverständigen',
    projects: 0,
    docTypes: ['Bescheid'],
  },
  {
    path: 'Einreichung',
    description: 'Einreichunterlagen für das Bauverfahren: Grundrisse, Schnitte, Ansichten, Baubeschreibung, Nachweise',
    projects: 0,
    docTypes: ['Grundriss', 'Schnitt', 'Ansicht'],
  },
  {
    path: 'Fachplaner',
    description: 'Unterlagen der Fachplaner: Statik, Bauphysik, Haustechnik, Brandschutz',
    projects: 0,
    docTypes: ['Gutachten'],
  },
  {
    path: 'Ausführung',
    description: 'Ausführungs- und Detailplanung, Ausschreibung, Verträge und Baustellenprotokolle',
    projects: 0,
    docTypes: ['Detail', 'Vertrag'],
  },
]

export interface FiledSample {
  folderPath: string
  tags: readonly string[] | null | undefined
}

export function docTypesByFolder(samples: readonly FiledSample[]): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>()
  for (const sample of samples) {
    const type = documentTypeOf(sample.tags)
    if (!type || type === 'Sonstiges') continue
    const key = folderPathKey(sample.folderPath)
    const perFolder = counts.get(key) ?? new Map<string, number>()
    perFolder.set(type, (perFolder.get(type) ?? 0) + 1)
    counts.set(key, perFolder)
  }
  const ranked = new Map<string, string[]>()
  for (const [key, perFolder] of counts) {
    ranked.set(
      key,
      [...perFolder.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_FOLDER_DOC_TYPES)
        .map(([type]) => type)
    )
  }
  return ranked
}

export function officeConventions(
  rows: readonly OfficeFolderRow[],
  existingPaths: readonly string[],
  docTypes: ReadonlyMap<string, string[]> = new Map()
): FilingConventionInput[] {
  const existing = new Set(existingPaths.map(folderPathKey))
  const trees = new Map<string, ReturnType<typeof folderTree>>()
  for (const projectId of new Set(rows.map((row) => row.projectId))) {
    trees.set(
      projectId,
      folderTree(
        rows
          .filter((row) => row.projectId === projectId)
          .map((row) => ({ id: row.id, parentId: row.parentId, accessMode: row.accessMode, everyoneReads: false }))
      )
    )
  }
  const byPath = new Map<string, { path: string; projects: Set<string>; descriptions: Map<string, number> }>()
  for (const row of rows) {
    const tree = trees.get(row.projectId)
    if (!tree || isUnderOwnList(tree, row.id)) continue
    const key = folderPathKey(row.path)
    if (!key || existing.has(key)) continue
    const entry = byPath.get(key) ?? { path: row.path, projects: new Set<string>(), descriptions: new Map<string, number>() }
    entry.projects.add(row.projectId)
    if (row.description) entry.descriptions.set(row.description, (entry.descriptions.get(row.description) ?? 0) + 1)
    byPath.set(key, entry)
  }
  if (byPath.size === 0) {
    return AUSTRIAN_DEFAULT_CONVENTIONS.filter((convention) => !existing.has(folderPathKey(convention.path)))
  }
  return [...byPath.entries()]
    .sort((a, b) => b[1].projects.size - a[1].projects.size || a[1].path.localeCompare(b[1].path))
    .slice(0, MAX_JUDGED_CONVENTIONS)
    .map(([key, entry]) => ({
      path: entry.path,
      description: [...entry.descriptions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      projects: entry.projects.size,
      docTypes: docTypes.get(key) ?? [],
    }))
}
