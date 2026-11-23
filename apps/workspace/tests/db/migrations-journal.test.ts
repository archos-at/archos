// @disk-inputs: migrations/**
/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSql } from '@/test-utils/sql-statements'

const DRIZZLE_DIR = path.resolve(__dirname, '../../migrations')

interface JournalEntry {
  idx: number
  tag: string
  when: number
}

const journal: { entries: JournalEntry[] } = JSON.parse(
  fs.readFileSync(path.join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8'),
)

const migrationFiles = fs
  .readdirSync(DRIZZLE_DIR)
  .filter((name) => name.endsWith('.sql') && !name.endsWith('.down.sql'))
  .map((name) => name.replace(/\.sql$/, ''))
  .sort()

describe('drizzle migration journal', () => {
  it('has an entry for every forward migration file', () => {
    const journalled = new Set(journal.entries.map((entry) => entry.tag))
    const unapplied = migrationFiles.filter((tag) => !journalled.has(tag))
    expect(unapplied).toEqual([])
  })

  it('has a migration file for every entry', () => {
    const onDisk = new Set(migrationFiles)
    const dangling = journal.entries.map((entry) => entry.tag).filter((tag) => !onDisk.has(tag))
    expect(dangling).toEqual([])
  })

  it('has a statement in every forward migration file', () => {
    const empty = migrationFiles.filter((tag) => readSql(path.join(DRIZZLE_DIR, `${tag}.sql`)).length === 0)
    expect(empty).toEqual([])
  })

  it('numbers migrations uniquely and without gaps', () => {
    const prefixes = migrationFiles.map((tag) => tag.slice(0, 4))
    const shared = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index)
    expect(shared).toEqual([])
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, index) => index))
  })

  it('orders entries by idx, matching the numeric file prefix', () => {
    const indexes = journal.entries.map((entry) => entry.idx)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
    for (const entry of journal.entries) {
      expect(entry.tag.startsWith(String(entry.idx).padStart(4, '0'))).toBe(true)
    }
  })

  it('has strictly increasing, unique `when` timestamps', () => {
    const whens = journal.entries.map((entry) => entry.when)
    const duplicated = whens.filter((value, index) => whens.indexOf(value) !== index)
    expect(duplicated).toEqual([])
    expect(whens).toEqual([...whens].sort((a, b) => a - b))
  })
})
