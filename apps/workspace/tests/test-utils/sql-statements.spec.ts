/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { createdTables, functionCalls, parseSql, startsWith } from './sql-statements'

const MIGRATION = `-- CREATE TABLE commented_out (id int);
CREATE TABLE IF NOT EXISTS public.tasks (id uuid, note text DEFAULT 'a; b');
/* CREATE TABLE also_commented (id int); */
CREATE UNLOGGED TABLE "Odd Name" (id int);
SELECT secure_table('tasks', 'organization_id');
DO $$ BEGIN PERFORM secure_table('inside_body'); END $$;
`

describe('sql-statements', () => {
  const statements = parseSql(MIGRATION)

  it('splits statements on semicolons outside strings, quoted names and dollar bodies', () => {
    expect(statements).toHaveLength(4)
    expect(startsWith(statements[2]!, 'select')).toBe(true)
  })

  it('names the tables a migration creates and skips commented-out ones', () => {
    expect(createdTables(statements)).toEqual(['tasks', 'Odd Name'])
  })

  it('reads the arguments of a function call', () => {
    expect(functionCalls(statements, 'secure_table').map((args) => args.map((a) => a.text))).toEqual([
      ['tasks', 'organization_id'],
    ])
  })
})
