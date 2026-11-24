/**
 * @vitest-environment node
 *
 * The shelf is the one definition of "which rows are these" that a project's
 * Dateien and the org-wide Archiv share (ADR-0078). Compiled to SQL here, so a
 * clause that stopped naming the tenant or the scope fails by name instead of
 * widening a listing across both.
 */
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  OFFICE_SHELF,
  documentShelf,
  personalShelf,
  projectShelf,
  shelfDocumentWhere,
  shelfFolderWhere,
  shelfOwner,
} from './shelf'

const dialect = new PgDialect()
const compile = (clause: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(clause)

describe('shelfDocumentWhere', () => {
  it('names the tenant, the scope and the project for a project shelf', () => {
    const { sql, params } = compile(shelfDocumentWhere(projectShelf('proj-1'), 'org-1'))

    expect(sql).toContain('"documents"."organization_id" = $1')
    expect(sql).toContain('"documents"."scope" = $2')
    expect(sql).toContain('"documents"."project_id" = $3')
    expect(params).toEqual(['org-1', 'project', 'proj-1'])
  })

  it('names the tenant and the scope — and no project — for the Archiv', () => {
    const { sql, params } = compile(shelfDocumentWhere(OFFICE_SHELF, 'org-1'))

    expect(sql).not.toContain('project_id')
    expect(params).toEqual(['org-1', 'office_shelf'])
  })
})

describe('a personal shelf (ADR-0193)', () => {
  it('names its owner on documents and folders, so no one else’s rows match', () => {
    const documentsOf = compile(shelfDocumentWhere(personalShelf('user_a'), 'org-1'))
    expect(documentsOf.sql).toContain('"documents"."owner_user_id"')
    expect(documentsOf.params).toEqual(['org-1', 'personal', 'user_a'])
    const foldersOf = compile(shelfFolderWhere(personalShelf('user_a'), 'org-1'))
    expect(foldersOf.sql).toContain('"project_folders"."owner_user_id"')
    expect(foldersOf.params).toEqual(['org-1', 'personal', 'user_a'])
  })
})

describe('shelfFolderWhere', () => {
  it('is the folder twin of the document clause', () => {
    expect(compile(shelfFolderWhere(projectShelf('proj-1'), 'org-1')).params).toEqual([
      'org-1',
      'project',
      'proj-1',
    ])
    const officeShelf = compile(shelfFolderWhere(OFFICE_SHELF, 'org-1'))
    expect(officeShelf.sql).toContain('"project_folders"."organization_id" = $1')
    expect(officeShelf.params).toEqual(['org-1', 'office_shelf'])
  })
})

describe('shelfOwner', () => {
  it('is what a new row on the shelf is inserted with', () => {
    expect(shelfOwner(projectShelf('proj-1'), 'org-1')).toEqual({
      organizationId: 'org-1',
      scope: 'project',
      projectId: 'proj-1',
      ownerUserId: null,
    })
    expect(shelfOwner(OFFICE_SHELF, 'org-1')).toEqual({
      organizationId: 'org-1',
      scope: 'office_shelf',
      projectId: null,
      ownerUserId: null,
    })
    expect(shelfOwner(personalShelf('user_a'), 'org-1')).toEqual({
      organizationId: 'org-1',
      scope: 'personal',
      projectId: null,
      ownerUserId: 'user_a',
    })
  })
})

describe('documentShelf', () => {
  it('reads the shelf off a stored row', () => {
    expect(documentShelf({ scope: 'project', projectId: 'proj-1', ownerUserId: null })).toEqual(projectShelf('proj-1'))
    expect(documentShelf({ scope: 'office_shelf', projectId: null, ownerUserId: null })).toEqual(OFFICE_SHELF)
  })

  it('reads a personal shelf with its owner, and none without one', () => {
    expect(documentShelf({ scope: 'personal', projectId: null, ownerUserId: 'user_a' })).toEqual(personalShelf('user_a'))
    expect(documentShelf({ scope: 'personal', projectId: null, ownerUserId: null })).toBeNull()
  })

  it('has none for a session attachment, which is filed nowhere', () => {
    expect(documentShelf({ scope: 'session', projectId: null, ownerUserId: null })).toBeNull()
  })
})
