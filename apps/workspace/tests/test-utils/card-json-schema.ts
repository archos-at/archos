import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function loadCardJsonSchema(): unknown {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'contracts', 'cards', 'schemas.json')
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'))
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`contracts/cards/schemas.json not found in any directory above ${process.cwd()}`)
    }
    dir = parent
  }
}
