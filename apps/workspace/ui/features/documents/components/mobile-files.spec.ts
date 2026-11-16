// @disk-inputs: ui/components/ui/middle-truncate.tsx, ui/features/documents/components/file-card.tsx, ui/features/documents/components/file-list-view.tsx, ui/features/documents/components/file-name.tsx, ui/features/documents/components/file-workspace.tsx, ui/features/documents/components/folder-bin-panel.tsx, ui/features/documents/components/folder-navigation.tsx, ui/features/documents/components/folder-object-menu.tsx

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blankComments } from '../../../../scripts/check-static-utility-modifiers.mjs'

const read = (file: string): string => blankComments(readFileSync(join(__dirname, file), 'utf8')) as string

describe('a file name keeps its end', () => {
  it.each([
    ['file-card.tsx', 'name'],
    ['file-list-view.tsx', 'documentDisplayName\\('],
  ])('%s draws the name through FileName', (file, subject) => {
    expect(read(file)).toMatch(new RegExp(`<FileName\\s+text=\\{${subject.replace('.', '\\.')}`))
  })

  it('a tile keeps two lines for its name, by the one rule every file name follows', () => {
    expect(read('file-card.tsx')).toMatch(/<FileName text=\{name\} lines=\{2\}/)
    expect(read('file-name.tsx')).toContain('<FittedName')
    expect(read('file-card.tsx')).not.toMatch(/overflow-wrap:anywhere|break-all/)
  })

  it('a folder is named on one line, cut at its end with its whole name as its title', () => {
    expect(read('folder-navigation.tsx')).toMatch(/<FolderName text=\{folder\.name\}/)
    expect(read('folder-table-row.tsx')).toMatch(/<FolderName text=\{folder\.name\}/)
  })

  it('FileName is read once', () => {
    const atom = read('../../../components/ui/fitted-name.tsx')
    expect(atom).toContain('aria-hidden')
    expect(atom).toContain('sr-only')
  })

  it('does not cut a document name with a bare `truncate` and a title', () => {
    for (const file of ['file-card.tsx', 'file-list-view.tsx']) {
      expect(read(file)).not.toMatch(/truncate"\s+title=\{(?:name|documentDisplayName)/)
    }
  })
})

describe('a hover reveal has a second way in on the pointer axis', () => {
  it.each(['file-card.tsx', 'folder-navigation.tsx', 'folder-object-menu.tsx'])(
    '%s shows its actions to a finger',
    (file) => {
      const source = read(file)
      const reveals = source.match(/[^"`]*md:opacity-0[^"`]*/g) ?? []
      expect(reveals.length).toBeGreaterThan(0)
      for (const reveal of reveals) expect(reveal).toContain('pointer-coarse:opacity-100')
    }
  )
})

describe('the phone header', () => {
  const workspace = read('file-workspace.tsx')

  it('does not pin its controls to their natural width', () => {
    expect(workspace).not.toMatch(/className="flex min-w-0 shrink-0 flex-wrap/)
  })

  it('keeps one upload control, and moves it rather than copying it', () => {
    const uses = workspace.match(/uploader\(\{ allowFolders: true, pickFilesRef, pickFolderRef(, glyphOnly: true)? \}\)/g) ?? []
    expect(uses).toHaveLength(2)
    expect(workspace).toContain('phone && !selection.active')
  })
})

describe('the folder tile on a phone', () => {
  const folders = read('folder-navigation.tsx')

  it('is a 56px sheet in the grid’s two columns, its ⋯ at its end, no chevron', () => {
    expect(folders.match(/data-folder-tile=""/g)?.length).toBeGreaterThanOrEqual(2)
    expect(folders).not.toContain('col-span-full')
    expect(folders).toMatch(/<FileTileBody className="flex h-14 /)
    expect(folders).toMatch(/-translate-y-1\/2 phone:right-1\.5/)
    expect(folders).toMatch(/size-4 shrink-0 phone:hidden" aria-hidden data-slot="folder-opens"/)
  })
})

describe('the Papierkorb', () => {
  const bin = read('folder-bin-panel.tsx')

  it('keeps the permanent action two deliberate steps from restore: a menu, then a confirm', () => {
    expect(bin).toContain('bin-actions-')
    expect(bin).toContain('ROW_REVEAL')
    expect(bin).toMatch(/variant: 'destructive'/)
    expect(bin).toMatch(/<ConfirmDialog[\s\S]*?onConfirm=\{purge\}/)
  })
})

describe('the list keeps its columns at a laptop’s width and says them on a phone', () => {
  const layout = read('file-list-layout.ts')
  const list = read('file-list-view.tsx')
  it('steps Größe and the head in from a 36rem list and Hinzugefügt from 42rem', () => {
    expect(layout).toMatch(/FILE_LIST_SIZE_CELL = '[^']*@xl\/filelist:table-cell'/)
    expect(layout).toMatch(/FILE_LIST_DATE_CELL = '[^']*@2xl\/filelist:table-cell'/)
    expect(list).toMatch(/<TableHeader className="bg-background sticky top-0 z-10 hidden @xl\/filelist:table-header-group">/)
  })
  it('pins the head in the pane’s scroll, so the table does not scroll sideways on its own', () => {
    expect(list).toMatch(/<Table\s+scrollX=\{false\}/)
  })
  it('says size and age on a narrow row’s second line, for files and folders alike', () => {
    expect(layout).toMatch(/FILE_LIST_META_LINE = '[^']*@xl\/filelist:hidden'/)
    expect(list).toMatch(/className=\{FILE_LIST_META_LINE\} data-testid="file-list-meta"/)
    expect(read('folder-table-row.tsx')).toMatch(/<span className=\{FILE_LIST_META_LINE\}>/)
    expect(read('folder-table-row.tsx')).toMatch(/changedAt \? <TimeAgo date=\{changedAt\} locale=\{locale\} \/> : '—'/)
  })
})
