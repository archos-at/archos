// @disk-inputs: deploy/Dockerfile, next.config.ts, bff/images/avatar-hosts.ts, bff/images/optimizable.ts, shared/config/request-body-limit.ts
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DockerfileParser } from 'dockerfile-ast'
import { importsOf, parseSource } from '@/test-utils/source-ast'

const UI_ROOT = path.resolve(__dirname, '../..')

function resolveImport(specifier: string): string {
  for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
    const candidate = specifier + ext
    if (existsSync(path.join(UI_ROOT, candidate))) return candidate
  }
  throw new Error(`next.config.ts imports '${specifier}', which does not resolve to a file`)
}

describe('next.config.ts runtime image copies', () => {
  const imports = importsOf(parseSource('next.config.ts', UI_ROOT))
    .map((edge) => edge.specifier)
    .filter((specifier) => specifier.startsWith('.'))
  const destinations = DockerfileParser.parse(readFileSync(path.join(UI_ROOT, 'deploy', 'Dockerfile'), 'utf8'))
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === 'COPY')
    .map((instruction) => instruction.getArguments().at(-1)?.getValue())

  it('has at least one relative import (guard against a silently empty parse)', () => {
    expect(imports.length).toBeGreaterThan(0)
  })

  it.each(imports.map((specifier) => [specifier, resolveImport(specifier)] as const))(
    'copies %s into the production image',
    (_specifier, file) => {
      expect(
        destinations,
        `deploy/Dockerfile must COPY ${file} — next.config.ts imports it at server start`,
      ).toContain(file)
    },
  )
})
