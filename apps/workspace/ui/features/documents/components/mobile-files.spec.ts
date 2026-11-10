// @disk-inputs: ui/components/ui/middle-truncate.tsx, ui/features/documents/components/file-card.tsx, ui/features/documents/components/file-list-view.tsx, ui/features/documents/components/file-name.tsx, ui/features/documents/components/file-workspace.tsx, ui/features/documents/components/folder-bin-panel.tsx, ui/features/documents/components/folder-navigation.tsx, ui/features/documents/components/folder-object-menu.tsx
/**
 * What the Dateien library keeps on a phone, held against its SOURCE.
 *
 * Each rule is a defect this surface shipped and nothing but a phone showed:
 * the revision cut off a drawing's name, a ⋯ that only a mouse could reveal, a
 * header that owned a third of the screen. Pixels belong to the browser; these
 * are the cheap invariants that hold on every commit (the same bargain
 * `components/ui/mobile-affordances.spec.ts` makes for the primitives).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blankComments } from '../../../../scripts/check-static-utility-modifiers.mjs'

const read = (file: string): string => blankComments(readFileSync(join(__dirname, file), 'utf8')) as string

describe('a file name keeps its end', () => {
  // Revision, drawing number and extension are the END of a name, and a finger
  // has no tooltip: `truncate` + `title` loses them silently on a phone.
  it.each([
    ['file-card.tsx', 'name'],
    ['file-list-view.tsx', 'documentDisplayName\\('],
  ])('%s draws the name through FileName', (file, subject) => {
    expect(read(file)).toMatch(new RegExp(`<FileName\\s+text=\\{${subject.replace('.', '\\.')}`))
  })

  it('a tile keeps two lines for its name, by the one rule every file name follows', () => {
    // „Baustellenbesprechun/g.pdf“ (a tile's `overflow-wrap: anywhere`) and „R…Stand-2026-11-03.pdf“ (a row's
    // MiddleTruncate) were two rules for one name (review of 2026-11-10, findings 5, 16, 17).
    expect(read('file-card.tsx')).toMatch(/<FileName text=\{name\} lines=\{2\}/)
    expect(read('file-name.tsx')).toContain('<FittedName')
    expect(read('file-card.tsx')).not.toMatch(/overflow-wrap:anywhere|break-all/)
  })

  it('a folder is named on one line, cut at its end with its whole name as its title', () => {
    // A folder's start tells it apart; one card of three lines made its row 138px beside rows of 82 (finding 6).
    expect(read('folder-navigation.tsx')).toMatch(/<FolderName text=\{folder\.name\}/)
    expect(read('folder-table-row.tsx')).toMatch(/<FolderName text=\{folder\.name\}/)
  })

  it('FileName is read once', () => {
    // The read-once lives in the atom, so every name it draws is read once.
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
  // `md:opacity-0` alone is a WIDTH question: an iPad in portrait is narrower
  // than `md` and a half-width desktop window is not. The pointer is the axis.
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
    // `shrink-0` on the controls row was why the Archiv's header measured 627px
    // in a 393px viewport: a flex-wrap row that cannot shrink never wraps.
    expect(workspace).not.toMatch(/className="flex min-w-0 shrink-0 flex-wrap/)
  })

  it('keeps one upload control, and moves it rather than copying it', () => {
    // Two instances are two hidden inputs and two owners of the pick refs.
    // The phone's instance is the same control, drawn as its 56px glyph (`glyphOnly`).
    const uses = workspace.match(/uploader\(\{ allowFolders: true, pickFilesRef, pickFolderRef(, glyphOnly: true)? \}\)/g) ?? []
    expect(uses).toHaveLength(2)
    expect(workspace).toContain('phone && !selection.active')
  })
})

describe('the folder tile on a phone', () => {
  const folders = read('folder-navigation.tsx')

  // Round 4 of Paper on a desk: three full-width folder rows put the first thumbnail at y=475 on a 390px phone. A
  // folder is a sheet in the grid's two columns (glyph, name, count); since the review of 2026-11-10 (finding 19) its
  // ⋯ stands at its end, as on every other row a finger meets, and the chevron steps aside for it.
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
    // Round 3 of Paper on a desk: restore is the raised press on the column's right edge, and the ⋯ beside it opens a
    // menu whose one row („Endgültig löschen“) asks again in a dialog. Distance on the row was the guard while the
    // delete was a press of its own; behind a menu and a confirm, a slipped thumb opens a menu and nothing is lost.
    expect(bin).toContain('bin-actions-')
    expect(bin).toContain('ROW_REVEAL')
    expect(bin).toMatch(/variant: 'destructive'/)
    expect(bin).toMatch(/<ConfirmDialog[\s\S]*?onConfirm=\{purge\}/)
  })
})
