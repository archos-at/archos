import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export const SOURCE_DIRS = ['app', 'bff', 'ui', 'i18n', 'shared', 'types', 'utils'] as const

export function sourceRoots(root: string = process.cwd()): string[] {
  return SOURCE_DIRS.map((dir) => join(root, dir))
}

const MOVED: Record<string, string> = {
  lib: 'bff',
  features: 'ui/features',
  components: 'ui/components',
  hooks: 'ui/hooks',
  styles: 'ui/styles',
  adapters: 'ui/adapters',
  'test-utils': 'tests/test-utils',
  mocks: 'tests/mocks',
}

export function srcPath(key: string, root: string = process.cwd()): string {
  const [head, ...rest] = key.split('/')
  return join(root, MOVED[head] ?? head, ...rest)
}

export function srcKey(file: string, root: string = process.cwd()): string {
  const path = relative(root, file).replace(/\\/g, '/')
  for (const [key, moved] of Object.entries(MOVED)) {
    if (path === moved || path.startsWith(`${moved}/`)) return `${key}${path.slice(moved.length)}`
  }
  return path
}

export function srcEntries(root: string = process.cwd()): string[] {
  return sourceRoots(root).flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((entry) => !entry.split(/[\\/]/).includes('node_modules'))
      .map((entry) => srcKey(join(dir, entry), root)),
  )
}

export function srcJoin(...parts: string[]): string {
  return srcPath(parts.join('/'))
}
