import { readFileSync } from 'node:fs'
import { expect, mock } from 'bun:test'

mock.module('server-only', () => ({}))
mock.module('external-svg-loader', () => ({}))
mock.module('external-svg-loader/dist/svg-loader.min.js', () => ({}))

const spec = expect.getState().testPath
if (spec && /vi\.mock\(\s*['"]server-only['"]/.test(readFileSync(spec, 'utf8'))) {
  throw new Error(
    `${spec} mocks 'server-only' itself, which undoes config/test-runner/aliases.ts's mock under bun test: delete that vi.mock line`,
  )
}
