import { describe, expect, it } from 'vitest'
import {
  buildFolderUploadPlan,
  countPlan,
  filesToUpload,
  isFolderUpload,
  needsUploadDecision,
  type FolderUploadPlanInput,
} from './folder-upload-plan'
import type { FileItem, FolderItem } from '../components/project-file-workspace'
import { SUGGESTED_SCREENING_POLICY } from '@/lib/upload-screening/policy'

function pathed(relativePath: string, size = 100): File {
  const name = relativePath.split('/').pop()!
  const file = new File(['x'.repeat(size)], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true })
  Object.defineProperty(file, 'size', { value: size, configurable: true })
  return file
}

function doc(overrides: Partial<FileItem> & Pick<FileItem, 'id' | 'filename'>): FileItem {
  return {
    displayName: null,
    fileSize: 100,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    originPath: null,
    contentHash: null,
    createdAt: '2026-01-01T00:00:00Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
    assignees: [],
    authoredBy: 'user',
    ...overrides,
  }
}

function folder(id: string, path: string, parentId: string | null = null): FolderItem {
  return { id, parentId, name: path.split('/').pop()!, path }
}

function plan(overrides: Partial<FolderUploadPlanInput> = {}) {
  return buildFolderUploadPlan({
    files: [],
    documents: [],
    folders: [],
    currentFolderId: null,
    ...overrides,
  })
}

describe('isFolderUpload', () => {
  it('is a folder only when a file carries a directory above it', () => {
    expect(isFolderUpload([pathed('Wohnbau/EG.pdf')])).toBe(true)
    expect(isFolderUpload([new File(['x'], 'EG.pdf')])).toBe(false)
  })
})

describe('buildFolderUploadPlan — the folders', () => {
  it('names every directory in the tree, ancestors included', () => {
    const result = plan({
      files: [pathed('Wohnbau/03_Einreichung/Plaene/EG.pdf')],
    })
    expect(result.folders.map((f) => f.path)).toEqual([
      'Wohnbau',
      'Wohnbau/03_Einreichung',
      'Wohnbau/03_Einreichung/Plaene',
    ])
    expect(result.counts.foldersCreated).toBe(3)
    expect(result.counts.foldersMatched).toBe(0)
  })

  it('matches an existing folder despite case and macOS Unicode form', () => {
    const decomposed = 'Pläne'
    const result = plan({
      files: [pathed(`Wohnbau/${decomposed}/EG.pdf`)],
      folders: [folder('f1', 'Wohnbau'), folder('f2', 'Wohnbau/PLÄNE', 'f1')],
    })
    expect(result.folders).toEqual([
      { path: 'Wohnbau', existingId: 'f1' },
      { path: `Wohnbau/${decomposed}`, existingId: 'f2' },
    ])
    expect(result.counts.foldersCreated).toBe(0)
  })

  it('resolves paths relative to the folder the reader is standing in', () => {
    const result = plan({
      files: [pathed('Plaene/EG.pdf')],
      folders: [folder('f1', 'Wohnbau'), folder('f2', 'Wohnbau/Plaene', 'f1')],
      currentFolderId: 'f1',
    })
    expect(result.folders).toEqual([{ path: 'Plaene', existingId: 'f2' }])
  })

  it('folds the drop root into the folder of the same name — the re-sync case', () => {
    const result = plan({
      files: [pathed('Wohnbau/Plaene/EG.pdf')],
      folders: [folder('f1', 'Wohnbau'), folder('f2', 'Wohnbau/Plaene', 'f1')],
      currentFolderId: 'f1',
    })
    expect(result.mergedIntoCurrentFolder).toBe(true)
    expect(result.folders).toEqual([{ path: 'Plaene', existingId: 'f2' }])
    expect(result.files[0].targetPath).toBe('Plaene')
  })

  it('does not fold when the drop has more than one root', () => {
    const result = plan({
      files: [pathed('Wohnbau/EG.pdf'), pathed('Altbau/OG.pdf')],
      folders: [folder('f1', 'Wohnbau')],
      currentFolderId: 'f1',
    })
    expect(result.mergedIntoCurrentFolder).toBe(false)
    expect(result.folders.map((f) => f.path).sort()).toEqual(['Altbau', 'Wohnbau'])
  })
})

describe('buildFolderUploadPlan — what happens to each file', () => {
  it('is new when the project has no document of that name', () => {
    const result = plan({ files: [pathed('Wohnbau/EG.pdf')] })
    expect(result.files[0].action).toBe('new')
    expect(result.counts.uploading).toBe(1)
  })

  it('is an update when the folder it lands in holds a document of that name', () => {
    const result = plan({
      files: [pathed('Wohnbau/EG.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', folderId: 'f1' })],
      folders: [folder('f1', 'Wohnbau')],
    })
    expect(result.files[0]).toMatchObject({
      action: 'update',
      existingId: 'd1',
      conflict: { within: 'folder', choice: 'replace', keepBothAs: 'EG 2.pdf' },
      onConflict: 'replace',
    })
  })

  it('matches by name only inside the target folder: the same name in another folder is another document', () => {
    const result = plan({
      files: [pathed('Wohnbau/Plaene/EG.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', folderId: 'elsewhere' })],
      folders: [folder('f1', 'Wohnbau'), folder('f2', 'Wohnbau/Plaene', 'f1')],
    })
    expect(result.files[0].action).toBe('new')
    expect(result.files[0].existingId).toBeUndefined()
    expect(result.files[0].onConflict).toBeUndefined()
    expect(filesToUpload(result).map((planned) => planned.file.name)).toEqual(['EG.pdf'])
  })

  it('counts the project root as a folder of its own', () => {
    const atRoot = plan({ files: [new File(['x'], 'EG.pdf')], documents: [doc({ id: 'd1', filename: 'EG.pdf' })] })
    const inFolder = plan({
      files: [new File(['x'], 'EG.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf' })],
      folders: [folder('f1', 'Plaene')],
      currentFolderId: 'f1',
    })
    expect(atRoot.files[0].action).toBe('update')
    expect(inFolder.files[0].action).toBe('new')
  })

  it('finds nothing in a folder the drop has still to create', () => {
    const result = plan({
      files: [pathed('Neu/EG.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', folderId: null })],
    })
    expect(result.files[0].action).toBe('new')
  })

  it('leaves a machine-authored row alone — a person is not correcting the agent', () => {
    const result = plan({
      files: [new File(['x'], 'Bericht.pdf')],
      documents: [doc({ id: 'd1', filename: 'Bericht.pdf', authoredBy: 'agent' })],
    })
    expect(result.files[0].action).toBe('new')
  })

  it('plans two files of one name in different folders of one drop as two documents', () => {
    const result = plan({
      files: [pathed('Wohnbau/A/Deckblatt.pdf'), pathed('Wohnbau/B/Deckblatt.pdf')],
    })
    expect(result.files.map((f) => f.action)).toEqual(['new', 'new'])
    expect(result.files.every((f) => f.conflict === undefined && f.onConflict === undefined)).toBe(true)
    expect(result.counts.uploading).toBe(2)
  })

  it('groups equal names in the SAME folder of one drop, and keeps both under the next free name', () => {
    const first = pathed('Wohnbau/A/Deckblatt.pdf')
    const second = pathed('Wohnbau/A/deckblatt.PDF')
    const result = plan({ files: [first, second] })

    expect(result.files[0]).toMatchObject({ action: 'new', onConflict: 'keep_both' })
    expect(result.files[0].conflict).toBeUndefined()
    expect(result.files[1]).toMatchObject({
      action: 'collision',
      conflict: { within: 'drop', choice: 'keep_both', keepBothAs: 'deckblatt 2.PDF' },
      onConflict: 'keep_both',
    })
    expect(result.counts.uploading).toBe(2)
    expect(filesToUpload(result).map((f) => f.file)).toEqual([first, second])
  })

  it('sends a drop duplicate the reader skips nowhere, and never as a replacement', () => {
    const first = pathed('A/Plan.pdf')
    const second = pathed('A/PLAN.pdf')
    const skipped = plan({ files: [first, second], conflictChoices: new Map([[second, 'skip']]) })
    const replaced = plan({ files: [first, second], conflictChoices: new Map([[second, 'replace']]) })

    expect(skipped.files[1]).toMatchObject({ action: 'collision', conflict: { choice: 'skip' } })
    expect(skipped.files[1].onConflict).toBeUndefined()
    expect(filesToUpload(skipped).map((f) => f.file)).toEqual([first])
    expect(skipped.counts).toMatchObject({ uploading: 1, skipped: 1 })
    expect(replaced.files[1]).toMatchObject({ conflict: { choice: 'keep_both' }, onConflict: 'keep_both' })
  })
})

describe('buildFolderUploadPlan — a drop of hundreds of repeated names (feld72, 1,881 files)', () => {
  it('plans every one of 250 name pairs across two folders for upload', () => {
    const files = Array.from({ length: 250 }, (_, i) => `Plan-${String(i + 1).padStart(3, '0')}.pdf`).flatMap((name) => [
      pathed(`Projekt/A/${name}`),
      pathed(`Projekt/B/${name}`),
    ])
    const result = plan({ files })

    expect(result.counts.collision).toBe(0)
    expect(result.counts.uploading).toBe(500)
    expect(filesToUpload(result)).toHaveLength(500)
    expect(needsUploadDecision(result)).toBe(false)
  })

  it('plans the whole 1,881-file tree, its 496 repeated names included, for upload', () => {
    const repeated = Array.from({ length: 248 }, (_, i) => `Detail_${i + 1}.pdf`).flatMap((name, i) => [
      pathed(`feld72/0${i % 7}_Planung/Bestand/${name}`),
      pathed(`feld72/0${i % 7}_Planung/Entwurf/${name}`),
    ])
    const unique = Array.from({ length: 1_881 - repeated.length }, (_, i) =>
      pathed(`feld72/${String(i % 23).padStart(2, '0')}_Ordner/Unterordner_${i % 5}/Datei_${i + 1}.pdf`),
    )
    const result = plan({ files: [...repeated, ...unique] })

    expect(repeated).toHaveLength(496)
    expect(result.files).toHaveLength(1_881)
    expect(result.files.filter((f) => f.action !== 'new')).toEqual([])
    expect(filesToUpload(result)).toHaveLength(1_881)
  })

  it('against a project that already holds the tree once, replaces each document in its own folder only', () => {
    const names = Array.from({ length: 250 }, (_, i) => `Plan-${String(i + 1).padStart(3, '0')}.pdf`)
    const files = names.flatMap((name) => [pathed(`A/${name}`), pathed(`B/${name}`)])
    const result = plan({
      files,
      folders: [folder('fa', 'A'), folder('fb', 'B')],
      documents: names.map((name, i) => doc({ id: `a-${i}`, filename: name, folderId: 'fa' })),
    })

    const inA = result.files.filter((f) => f.targetPath === 'A')
    const inB = result.files.filter((f) => f.targetPath === 'B')
    expect(inA.every((f) => f.action === 'update' && f.existingId === `a-${names.indexOf(f.file.name)}`)).toBe(true)
    expect(inB.every((f) => f.action === 'new' && f.existingId === undefined)).toBe(true)
    expect(filesToUpload(result)).toHaveLength(500)
  })
})

describe('buildFolderUploadPlan — the names a document answers to', () => {
  const statik = [folder('f-statik', 'Statik')]

  it('matches a decomposed name against the composed one already stored', () => {
    const composed = 'Pr\u00fcfbericht.pdf'
    const decomposed = 'Pru\u0308fbericht.pdf'
    expect(composed).not.toBe(decomposed)

    const result = plan({
      files: [pathed(`Statik/${decomposed}`)],
      folders: statik,
      documents: [doc({ id: 'd1', filename: composed, folderId: 'f-statik' })],
    })

    expect(result.files[0].action).toBe('update')
    expect(result.files[0].existingId).toBe('d1')
    expect(result.counts.new).toBe(0)
  })

  it('counts two Unicode spellings of one name in one folder of a drop as one group', () => {
    const result = plan({
      files: [pathed('A/Pr\u00fcfung.pdf'), pathed('A/Pru\u0308fung.pdf')],
    })
    expect(result.files.map((file) => file.action)).toEqual(['new', 'collision'])
  })

  it('names the document a row will replace when the project calls it something else', () => {
    const result = plan({
      files: [pathed('Statik/Deckblatt.pdf')],
      folders: statik,
      documents: [doc({ id: 'd1', filename: 'Deckblatt.pdf', displayName: 'Statik — Deckblatt', folderId: 'f-statik' })],
    })
    expect(result.files[0].action).toBe('update')
    expect(result.files[0].existingName).toBe('Statik — Deckblatt')
  })

  it('says nothing about the name when it is the one in the drop', () => {
    const result = plan({
      files: [pathed('Statik/Deckblatt.pdf')],
      folders: statik,
      documents: [doc({ id: 'd1', filename: 'Deckblatt.pdf', folderId: 'f-statik' })],
    })
    expect(result.files[0].existingName).toBeUndefined()
  })

  it('holds a file that differs only in case as the same name, as APFS and NTFS do', () => {
    const result = plan({
      files: [pathed('Statik/DECKBLATT.pdf')],
      folders: statik,
      documents: [doc({ id: 'd1', filename: 'Deckblatt.pdf', folderId: 'f-statik' })],
    })
    expect(result.files[0]).toMatchObject({
      action: 'update',
      existingId: 'd1',
      existingName: 'Deckblatt.pdf',
      conflict: { within: 'folder', choice: 'replace', keepBothAs: 'DECKBLATT 2.pdf' },
    })
  })

  it('holds a name the document was renamed to, as the server does', () => {
    const result = plan({
      files: [pathed('Statik/Statikbericht 2026.pdf')],
      folders: statik,
      documents: [
        doc({ id: 'd1', filename: 'sb-final-v3.pdf', displayName: 'Statikbericht 2026.pdf', folderId: 'f-statik' }),
      ],
    })
    expect(result.files[0]).toMatchObject({ action: 'update', existingId: 'd1' })
  })

  it('does not hold back a file that merely shares a name with somebody\'s origin path', () => {
    const result = plan({
      files: [pathed('Statik/EG.pdf')],
      folders: statik,
      documents: [doc({ id: 'd1', filename: 'EG (1).pdf', originPath: 'Wohnbau/Statik/EG.pdf', folderId: 'f-statik' })],
    })
    expect(result.files[0].action).toBe('new')
  })

  it('prefers the exact name over a looser one', () => {
    const result = plan({
      files: [pathed('Statik/Bericht.pdf')],
      folders: statik,
      documents: [
        doc({ id: 'renamed', filename: 'x.pdf', displayName: 'Bericht.pdf', folderId: 'f-statik' }),
        doc({ id: 'alias', filename: 'BERICHT.pdf', folderId: 'f-statik' }),
        doc({ id: 'exact', filename: 'Bericht.pdf', folderId: 'f-statik' }),
      ],
    })
    expect(result.files[0].action).toBe('update')
    expect(result.files[0].existingId).toBe('exact')
  })

  it('suggests a name for keeping both that is free in that folder, past the names the drop brings along', () => {
    const result = plan({
      files: [pathed('Statik/Plan.pdf'), pathed('Statik/Plan 3.pdf')],
      folders: statik,
      documents: [
        doc({ id: 'd1', filename: 'Plan.pdf', folderId: 'f-statik' }),
        doc({ id: 'd2', filename: 'Plan 2.pdf', folderId: 'f-statik' }),
        doc({ id: 'other', filename: 'Plan 4.pdf', folderId: 'elsewhere' }),
      ],
    })
    expect(result.files[0].conflict?.keepBothAs).toBe('Plan 4.pdf')
  })

  it('takes the reader\'s answer for a held name, and sends it with the file', () => {
    const files = [pathed('Statik/A.pdf'), pathed('Statik/B.pdf'), pathed('Statik/C.pdf')]
    const result = plan({
      files,
      folders: statik,
      documents: ['A.pdf', 'B.pdf', 'C.pdf'].map((name) => doc({ id: name, filename: name, folderId: 'f-statik' })),
      conflictChoices: new Map([
        [files[1], 'keep_both'],
        [files[2], 'skip'],
      ]),
    })
    expect(result.files.map((f) => [f.conflict?.choice, f.onConflict])).toEqual([
      ['replace', 'replace'],
      ['keep_both', 'keep_both'],
      ['skip', undefined],
    ])
    expect(filesToUpload(result).map((f) => f.file)).toEqual(files.slice(0, 2))
    expect(result.counts).toMatchObject({ update: 3, skipped: 1, uploading: 2 })
  })
})

describe('buildFolderUploadPlan — the delta', () => {
  const digestA = `sha256:${'a'.repeat(64)}`
  const digestB = `sha256:${'b'.repeat(64)}`
  const w = [folder('f-w', 'W')]

  it('asks for a digest only where "unchanged" is possible at all', () => {
    const sameNameSameSize = pathed('W/EG.pdf', 100)
    const sameNameOtherSize = pathed('W/OG.pdf', 200)
    const noStoredDigest = pathed('W/DG.pdf', 100)
    const brandNew = pathed('W/New.pdf', 100)

    const result = plan({
      files: [sameNameSameSize, sameNameOtherSize, noStoredDigest, brandNew],
      folders: w,
      documents: [
        doc({ id: 'd1', filename: 'EG.pdf', fileSize: 100, contentHash: digestA, folderId: 'f-w' }),
        doc({ id: 'd2', filename: 'OG.pdf', fileSize: 999, contentHash: digestA, folderId: 'f-w' }),
        doc({ id: 'd3', filename: 'DG.pdf', fileSize: 100, contentHash: null, folderId: 'f-w' }),
      ],
    })

    expect(result.hashCandidates).toEqual([sameNameSameSize])
  })

  it('skips a file whose bytes are identical, and sends one whose are not', () => {
    const unchanged = pathed('W/EG.pdf', 100)
    const changed = pathed('W/OG.pdf', 100)
    const input: FolderUploadPlanInput = {
      files: [unchanged, changed],
      documents: [
        doc({ id: 'd1', filename: 'EG.pdf', fileSize: 100, contentHash: digestA, folderId: 'f-w' }),
        doc({ id: 'd2', filename: 'OG.pdf', fileSize: 100, contentHash: digestA, folderId: 'f-w' }),
      ],
      folders: w,
      currentFolderId: null,
      digests: new Map([
        [unchanged, digestA],
        [changed, digestB],
      ]),
    }

    const result = buildFolderUploadPlan(input)
    expect(result.files.map((f) => f.action)).toEqual(['unchanged', 'update'])
    expect(result.counts.unchanged).toBe(1)
    expect(filesToUpload(result).map((f) => f.file)).toEqual([changed])
  })

  it('treats a digest it could not compute as changed, never as unchanged', () => {
    const unreadable = pathed('W/EG.pdf', 100)
    const result = buildFolderUploadPlan({
      files: [unreadable],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', fileSize: 100, contentHash: digestA, folderId: 'f-w' })],
      folders: w,
      currentFolderId: null,
      digests: new Map(),
    })
    expect(result.files[0].action).toBe('update')
  })
})

describe('countPlan / filesToUpload', () => {
  it('drops a skipped update from both the count and the batch', () => {
    const files = [pathed('W/New.pdf'), pathed('W/EG.pdf')]
    const input = {
      files,
      folders: [folder('f-w', 'W')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', folderId: 'f-w' })],
    }
    const replaced = plan(input)
    const skipped = plan({ ...input, conflictChoices: new Map([[files[1], 'skip']]) })

    expect(countPlan(replaced.files, replaced.folders).uploading).toBe(2)
    expect(countPlan(skipped.files, skipped.folders).uploading).toBe(1)
    expect(filesToUpload(skipped).map((f) => f.file.name)).toEqual(['New.pdf'])
  })
})

describe('a loose file against the listing', () => {
  function loose(name: string, size = 100): File {
    const file = new File(['x'.repeat(size)], name, { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: size, configurable: true })
    return file
  }

  it('is an update of the document of that name, filed where the reader stands', () => {
    const result = plan({
      files: [loose('EG.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', folderId: 'f1' })],
      folders: [folder('f1', 'Plaene')],
      currentFolderId: 'f1',
    })

    expect(result.folders).toEqual([])
    expect(result.files[0]).toMatchObject({ action: 'update', existingId: 'd1', targetPath: '' })
    expect(needsUploadDecision(result)).toBe(true)
  })

  it('is a document of its own when the name lives in another folder than the one the reader drops into', () => {
    const result = plan({
      files: [loose('EG.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', folderId: 'f1' })],
      folders: [folder('f1', 'Plaene'), folder('f2', 'Statik')],
      currentFolderId: 'f2',
    })

    expect(result.files[0].action).toBe('new')
    expect(needsUploadDecision(result)).toBe(false)
  })

  it('needs no decision when nothing on the shelf shares a name', () => {
    const result = plan({
      files: [loose('Neu.pdf'), loose('Auch-neu.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf' })],
    })

    expect(needsUploadDecision(result)).toBe(false)
  })

  it('counts a hash candidate as a decision on the first pass — it is an update until proven identical', () => {
    const result = plan({
      files: [loose('EG.pdf', 100)],
      documents: [doc({ id: 'd1', filename: 'EG.pdf', fileSize: 100, contentHash: 'sha256:abc' })],
    })

    expect(result.hashCandidates).toHaveLength(1)
    expect(needsUploadDecision(result)).toBe(true)
  })

  it('ignores a machine-authored row of the same name, as the server does', () => {
    const result = plan({
      files: [loose('Bericht.pdf')],
      documents: [doc({ id: 'a1', filename: 'Bericht.pdf', authoredBy: 'agent' })],
    })

    expect(needsUploadDecision(result)).toBe(false)
  })
})

describe('buildFolderUploadPlan — an archived match', () => {
  it('marks an update of an archived document', () => {
    const result = plan({
      files: [new File(['x'.repeat(50)], 'EG.pdf')],
      documents: [{ ...doc({ id: 'd1', filename: 'EG.pdf' }), lifecycle: 'archived' }],
    })
    expect(result.files[0]).toMatchObject({ action: 'update', existingId: 'd1', existingArchived: true })
  })

  it('marks an archived document that holds the name in another case', () => {
    const result = plan({
      files: [new File(['x'], 'eg.pdf')],
      documents: [{ ...doc({ id: 'd1', filename: 'EG.pdf' }), lifecycle: 'archived' }],
    })
    expect(result.files[0]).toMatchObject({ action: 'update', existingArchived: true })
  })

  it('leaves an active match unmarked', () => {
    const result = plan({
      files: [new File(['x'.repeat(50)], 'EG.pdf')],
      documents: [doc({ id: 'd1', filename: 'EG.pdf' })],
    })
    expect(result.files[0]).not.toHaveProperty('existingArchived')
  })

  it('plans against a name-probe row, which carries only what matching needs', () => {
    const result = plan({
      files: [new File(['x'.repeat(50)], 'EG.pdf')],
      documents: [
        {
          id: 'd1',
          filename: 'EG.pdf',
          displayName: null,
          fileSize: 10,
          contentHash: null,
          status: 'completed',
          folderId: null,
          authoredBy: 'user',
          lifecycle: 'active',
        },
      ],
    })
    expect(result.files[0]).toMatchObject({ action: 'update', existingId: 'd1' })
  })
})

describe('buildFolderUploadPlan — upload screening', () => {
  const screening = { policy: SUGGESTED_SCREENING_POLICY, basePath: null }

  it('excludes a file whose folder is named, and does not create that folder', () => {
    const payslip = pathed('Büro/Personalakten/0042.pdf')
    const result = plan({ files: [pathed('Büro/Pläne/EG.pdf'), payslip], screening })

    const excluded = result.files.find((file) => file.file === payslip)
    expect(excluded?.action).toBe('excluded')
    expect(excluded?.screening).toEqual([{ term: 'Personal', segment: 'Personalakten', kind: 'folder' }])
    expect(result.folders.map((planned) => planned.path)).toEqual(['Büro', 'Büro/Pläne'])
    expect(result.counts.excluded).toBe(1)
    expect(filesToUpload(result).map((planned) => planned.file)).not.toContain(payslip)
    expect(needsUploadDecision(result)).toBe(true)
  })

  it('screens what a ZIP holds by its path inside the archive, as a dropped folder (#850)', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const bytes = zipSync({
      'Büro/Pläne/EG.pdf': strToU8('plan'),
      'Büro/Lohnzettel/2026-09.pdf': strToU8('pay'),
      'Büro/Honorarnote_Ost.pdf': strToU8('fee'),
    })
    const { expandZips } = await import('./expand-zip')
    const { files } = await expandZips([new File([bytes as BlobPart], 'Ablage.zip', { type: 'application/zip' })])
    const result = plan({ files, screening })

    const actionOf = (name: string) => result.files.find((planned) => planned.file.name === name)?.action
    expect(actionOf('EG.pdf')).not.toBe('excluded')
    expect(actionOf('2026-09.pdf')).toBe('excluded')
    expect(actionOf('Honorarnote_Ost.pdf')).toBe('excluded')
    expect(result.folders.map((planned) => planned.path)).not.toContain('Büro/Lohnzettel')
  })

  it('screens against the folder the file lands in, too', () => {
    const scan = new File(['x'], '0042.pdf')
    const result = plan({ files: [scan], screening: { ...screening, basePath: 'Verwaltung/Honorare' } })
    expect(result.files[0]).toMatchObject({
      action: 'excluded',
      screening: [{ term: 'Honorar', segment: 'Honorare', kind: 'folder' }],
    })
  })

  it('lets a released file through as what it would otherwise be, marked as released', () => {
    const contract = pathed('Projekt/Verträge/Architektenvertrag.pdf')
    const result = plan({ files: [contract], screening: { ...screening, released: new Set([contract]) } })

    expect(result.files[0]).toMatchObject({ action: 'new', screeningReleased: true })
    expect(result.files[0]?.screening?.length).toBeGreaterThan(0)
    expect(result.folders.map((planned) => planned.path)).toEqual(['Projekt', 'Projekt/Verträge'])
    expect(filesToUpload(result)).toHaveLength(1)
  })

  it('does not let an excluded file collide with an admitted one of the same name', () => {
    const plan1 = pathed('A/Pläne/Deckblatt.pdf')
    const plan2 = pathed('A/Rechnungen/Deckblatt.pdf')
    const result = plan({ files: [plan1, plan2], screening })
    expect(result.files.map((file) => file.action)).toEqual(['new', 'excluded'])
  })

  it('screens nothing when no policy is handed in', () => {
    const result = plan({ files: [pathed('X/Rechnungen/a.pdf')] })
    expect(result.files[0]?.action).toBe('new')
  })

  it('screens the folders on disk a file came from, and plans no folder for it', () => {
    const result = plan({ files: [pathed('Rechnungen/Grundriss.pdf')], screening })
    expect(result.files[0]).toMatchObject({
      action: 'excluded',
      screening: [{ term: 'Rechnung', segment: 'Rechnungen', kind: 'folder' }],
    })
    expect(result.folders).toEqual([])
  })
})

function offer(
  name: string,
  candidates: Array<{ id: string; filename: string; label?: string; displayName?: string | null }>,
  overrides: { newer?: boolean; unambiguous?: boolean } = {},
) {
  return {
    name,
    candidates: candidates.map((candidate) => ({ label: '', displayName: null, ...candidate })),
    newer: overrides.newer ?? true,
    unambiguous: overrides.unambiguous ?? candidates.length === 1,
  }
}

describe('buildFolderUploadPlan — Fassungen across names (ADR-0099)', () => {
  const B = { id: 'b', filename: 'EG_Grundriss_Index_B.pdf', label: 'Index B' }

  it('attaches the offer to a new file and ticks it when the match is unambiguous', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const result = plan({ files: [file], revisionOffers: new Map([[file.name, offer(file.name, [B])]]) })

    expect(result.files[0].action).toBe('new')
    expect(result.files[0].revisionOf).toMatchObject({
      of: { id: 'b', filename: 'EG_Grundriss_Index_B.pdf', name: 'EG_Grundriss_Index_B.pdf', label: 'Index B' },
      unambiguous: true,
      chosen: true,
    })
  })

  it('shows the document by its rename when it has one', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const result = plan({
      files: [file],
      revisionOffers: new Map([[file.name, offer(file.name, [{ ...B, displayName: 'Grundriss EG' }])]]),
    })

    expect(result.files[0].revisionOf?.of.name).toBe('Grundriss EG')
  })

  it('leaves an ambiguous offer unticked, and takes the newest candidate as the one it is about', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const other = { id: 'a', filename: 'EG_Grundriss_Index_A.pdf' }
    const result = plan({ files: [file], revisionOffers: new Map([[file.name, offer(file.name, [B, other])]]) })

    expect(result.files[0].revisionOf).toMatchObject({ of: { id: 'b' }, unambiguous: false, chosen: false })
  })

  it('leaves a file that is not newer unticked', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_A.pdf')
    const result = plan({
      files: [file],
      revisionOffers: new Map([[file.name, offer(file.name, [B], { newer: false, unambiguous: false })]]),
    })

    expect(result.files[0].revisionOf).toMatchObject({ newer: false, chosen: false })
  })

  it('takes the reader’s tick over the default, and their pick among the candidates', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const other = { id: 'a', filename: 'EG_Grundriss_Index_A.pdf' }
    const input = { files: [file], revisionOffers: new Map([[file.name, offer(file.name, [B, other])]]) }

    expect(plan({ ...input, revisionChoices: new Map([[file, { chosen: true }]]) }).files[0].revisionOf?.chosen).toBe(true)
    const picked = plan({ ...input, revisionChoices: new Map([[file, { targetId: 'a', chosen: true }]]) }).files[0]
    expect(picked.revisionOf).toMatchObject({ of: { id: 'a' }, chosen: true })
    expect(plan({ files: [file], revisionOffers: new Map([[file.name, offer(file.name, [B])]]), revisionChoices: new Map([[file, { chosen: false }]]) }).files[0].revisionOf?.chosen).toBe(false)
  })

  it('offers nothing to a file whose name the shelf already holds: that is a new version (ADR-0054)', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf', { type: 'application/pdf' })
    const result = plan({
      files: [file],
      documents: [doc({ id: 'c', filename: 'EG_Grundriss_Index_C.pdf', fileSize: 999 })],
      revisionOffers: new Map([[file.name, offer(file.name, [B])]]),
    })

    expect(result.files[0].action).toBe('update')
    expect(result.files[0].revisionOf).toBeUndefined()
  })

  it('leaves an unchanged re-export unchanged and skipped: same name, same bytes, no proposal', () => {
    const file = pathed('Export/EG_Grundriss_Index_C.pdf', 100)
    const result = plan({
      files: [file],
      folders: [folder('f-export', 'Export')],
      documents: [doc({ id: 'c', filename: 'EG_Grundriss_Index_C.pdf', fileSize: 100, contentHash: 'sha-1', folderId: 'f-export' })],
      digests: new Map([[file, 'sha-1']]),
      revisionOffers: new Map([[file.name, offer(file.name, [B])]]),
    })

    expect(result.files[0]).toMatchObject({ action: 'unchanged' })
    expect(result.files[0].revisionOf).toBeUndefined()
    expect(result.counts.uploading).toBe(0)
  })

  it('does not offer an excluded file, whatever its name continues', () => {
    const file = new File(['x'], 'Rechnung_Index_C.pdf')
    const result = plan({
      files: [file],
      revisionOffers: new Map([[file.name, offer(file.name, [B])]]),
      screening: { policy: SUGGESTED_SCREENING_POLICY, basePath: null },
    })

    if (result.files[0].action === 'excluded') expect(result.files[0].revisionOf).toBeUndefined()
  })

  it('does not tick two files of one drop for one document: only the newest of them is the successor', () => {
    const c = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const d = new File(['x'], 'EG_Grundriss_Index_D.pdf')
    const result = plan({
      files: [c, d],
      revisionOffers: new Map([
        [c.name, offer(c.name, [B])],
        [d.name, offer(d.name, [B])],
      ]),
    })

    const byName = new Map(result.files.map((file) => [file.file.name, file.revisionOf]))
    expect(byName.get(d.name)).toMatchObject({ unambiguous: true, chosen: true })
    expect(byName.get(c.name)).toMatchObject({ unambiguous: false, chosen: false })
  })

  it('asks about a drop of loose files that only continue documents', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const without = plan({ files: [file] })
    const withOffer = plan({ files: [file], revisionOffers: new Map([[file.name, offer(file.name, [B])]]) })

    expect(needsUploadDecision(without)).toBe(false)
    expect(needsUploadDecision(withOffer)).toBe(true)
  })

  it('counts a file filed as a Fassung like any new file, and uploads it', () => {
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const result = plan({ files: [file], revisionOffers: new Map([[file.name, offer(file.name, [B])]]) })

    expect(filesToUpload(result).map((planned) => planned.file)).toEqual([file])
    expect(result.counts.new).toBe(1)
  })

  it('is a different outcome when the reader ticks another box', async () => {
    const { samePlanOutcome } = await import('./folder-upload-plan')
    const file = new File(['x'], 'EG_Grundriss_Index_C.pdf')
    const offers = new Map([[file.name, offer(file.name, [B])]])

    const ticked = plan({ files: [file], revisionOffers: offers })
    const unticked = plan({ files: [file], revisionOffers: offers, revisionChoices: new Map([[file, { chosen: false }]]) })

    expect(samePlanOutcome(ticked, ticked)).toBe(true)
    expect(samePlanOutcome(ticked, unticked)).toBe(false)
  })
})
