import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'

export const REGENERATE = 'task generate'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

export function expectGenerated(path: string, generated: string): void {
  if (process.env.UPDATE_FIXTURES === '1') {
    writeFileSync(path, generated, 'utf8')
    return
  }
  const committed = existsSync(path) ? readFileSync(path, 'utf8') : null
  expect(
    committed,
    `${relative(REPO_ROOT, path)} is generated from code and no longer matches it. ` +
      `Run \`${REGENERATE}\` and commit what it rewrites in this change.`,
  ).toBe(generated)
}
