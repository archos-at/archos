import type { ProjectUploadScreeningState } from '@/adapters/api/project-upload-screening-client'
import type { FolderItem } from '@/features/documents/file-types'
import type { FilingSetupClient } from '@/features/project-intake/components/filing/filing-client'
import { SUGGESTED_SCREENING_POLICY } from '@/lib/upload-screening/policy'
import { applyProjectOverride, effectiveOverride, type ProjectScreeningOverride } from '@/lib/upload-screening/project-policy'

export function fixtureFile(path: string, size: number): File {
  const name = path.split('/').pop() ?? path
  const file = new File([], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true })
  Object.defineProperty(file, 'size', { value: size, configurable: true })
  return file
}

const MB = 1024 * 1024

export const FILING_PROJECT_FOLDER: File[] = [
  fixtureFile('Wohnbau Nord/01_Grundlagen/Lageplan_1-500.pdf', 2.4 * MB),
  fixtureFile('Wohnbau Nord/01_Grundlagen/Grundbuchauszug.pdf', 0.3 * MB),
  fixtureFile('Wohnbau Nord/01_Grundlagen/Flächenwidmungsplan.pdf', 1.1 * MB),
  fixtureFile('Wohnbau Nord/02_Bestand/Bestandsplan_EG.pdf', 3.2 * MB),
  fixtureFile('Wohnbau Nord/02_Bestand/Bestandsplan_OG1.pdf', 3.1 * MB),
  fixtureFile('Wohnbau Nord/03_Einreichung/Einreichplan_EG.pdf', 4.8 * MB),
  fixtureFile('Wohnbau Nord/03_Einreichung/Einreichplan_Schnitte.pdf', 4.2 * MB),
  fixtureFile('Wohnbau Nord/03_Einreichung/Baubeschreibung.pdf', 0.4 * MB),
  fixtureFile('Wohnbau Nord/03_Einreichung/_alt/Einreichplan_EG_v1.pdf', 4.7 * MB),
  fixtureFile('Wohnbau Nord/03_Einreichung/_alt/Einreichplan_EG_v0.pdf', 4.6 * MB),
  fixtureFile('Wohnbau Nord/04_Behörde/Bescheid_MA37.pdf', 0.5 * MB),
  fixtureFile('Wohnbau Nord/05_Fachplaner/Statik/Statische Berechnung.pdf', 6.3 * MB),
  fixtureFile('Wohnbau Nord/05_Fachplaner/Brandschutz/Brandschutzkonzept.pdf', 1.2 * MB),
  fixtureFile('Wohnbau Nord/06_Verträge/Werkvertrag_Baumeister.pdf', 0.6 * MB),
  fixtureFile('Wohnbau Nord/06_Verträge/Bauvertrag.pdf', 0.7 * MB),
  fixtureFile('Wohnbau Nord/07_Honorare/Honorarnote_2026-03.pdf', 0.1 * MB),
  fixtureFile('Wohnbau Nord/07_Honorare/Honorarnote_2026-06.pdf', 0.1 * MB),
  fixtureFile('Wohnbau Nord/Backup/Wohnbau_Nord_2026-09.zip', 820 * MB),
  fixtureFile('Wohnbau Nord/temp/Plot_EG_A1.pdf', 5.0 * MB),
]

export const FILING_SCREENING: ProjectUploadScreeningState = {
  policy: SUGGESTED_SCREENING_POLICY,
  office: SUGGESTED_SCREENING_POLICY,
  officeSuggested: true,
  override: { addedNameTerms: [], removedNameTerms: [] },
  canManage: true,
}

export const FILING_SCREENING_CHANGED: ProjectUploadScreeningState = (() => {
  const override = { addedNameTerms: ['Wettbewerb intern'], removedNameTerms: ['Vertrag'] }
  return { ...FILING_SCREENING, override, policy: applyProjectOverride(SUGGESTED_SCREENING_POLICY, override) }
})()

export const FILING_SCREENING_READONLY: ProjectUploadScreeningState = { ...FILING_SCREENING, canManage: false }

const folder = (id: string, parentId: string | null, path: string, ownAccess: FolderItem['ownAccess'] = null): FolderItem => ({
  id,
  parentId,
  name: path.split('/').pop() ?? path,
  path,
  ownAccess,
  access: 'write',
})

export const FILING_FOLDERS_UPLOADED: FolderItem[] = [
  folder('f-root', null, 'Wohnbau Nord'),
  folder('f-01', 'f-root', 'Wohnbau Nord/01_Grundlagen'),
  folder('f-02', 'f-root', 'Wohnbau Nord/02_Bestand'),
  folder('f-03', 'f-root', 'Wohnbau Nord/03_Einreichung'),
  folder('f-04', 'f-root', 'Wohnbau Nord/04_Behörde'),
  folder('f-05', 'f-root', 'Wohnbau Nord/05_Fachplaner'),
  folder('f-06', 'f-root', 'Wohnbau Nord/06_Verträge', { everyoneReads: true }),
  folder('f-07', 'f-root', 'Wohnbau Nord/07_Honorare', { everyoneReads: false }),
]

export function fakeFilingClient(
  screening: ProjectUploadScreeningState,
  folders: readonly FolderItem[]
): FilingSetupClient {
  let current = screening
  let listed = [...folders]
  return {
    loadScreening: async () => current,
    saveScreening: async (_projectId, override: ProjectScreeningOverride) => {
      const kept = effectiveOverride(current.office, override)
      current = { ...current, override: kept, policy: applyProjectOverride(current.office, kept) }
      return current
    },
    listFolders: async () => listed,
    ensureFolder: async (_projectId, path) => {
      const found = listed.find((entry) => entry.path === path)
      if (found) return found
      const created = folder(`f-new-${listed.length}`, null, path)
      listed = [...listed, created]
      return created
    },
  }
}
