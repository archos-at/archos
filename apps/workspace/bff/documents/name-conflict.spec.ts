import { describe, expect, it } from 'vitest'
import { NameConflictError, RenameConflictError } from './name-conflict'

const conflict = {
  reason: 'name_conflict' as const,
  name: 'Plan.md',
  folderId: 'folder-a',
  existingDocumentId: 'doc-a',
  existingName: 'Plan.md',
  suggestedName: 'Plan 2.md',
}

describe('the name conflict messages', () => {
  it('asks an upload or a move for onConflict', () => {
    expect(new NameConflictError(conflict).message).toContain('onConflict: replace, keep_both')
  })

  it('tells a rename to choose another name, since a rename takes no onConflict', () => {
    const error = new RenameConflictError(conflict)

    expect(error).toBeInstanceOf(NameConflictError)
    expect(error.message).toBe('A document named "Plan.md" is already in this folder. Choose another name, such as "Plan 2.md".')
    expect(error.message).not.toContain('onConflict')
    expect(error.conflict).toEqual(conflict)
  })
})
