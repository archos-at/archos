// @disk-inputs: deploy/Dockerfile, observability/http-metrics.js, observability/otel-metrics.js, server.js, bff/limits/factory.js, bff/limits/rules.js, bff/limits/ws-frames.js, bff/proxy/backend-target.js, bff/proxy/ws-teardown.js, bff/proxy/ws-upgrade-headers.js, bff/redis/connect.js, bff/turns/turn-headers.js
/**
 * @vitest-environment node
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_ROOT = path.resolve(__dirname, '../..')

function relativeRequiresOf(source: string): string[] {
  const requires: string[] = []
  for (const match of source.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
    requires.push(match[1].replace(/^\.\//, ''))
  }
  return requires
}

describe('server.js runtime image copies', () => {
  const source = readFileSync(path.join(UI_ROOT, 'server.js'), 'utf8')
  const dockerfile = readFileSync(path.join(UI_ROOT, 'deploy', 'Dockerfile'), 'utf8')
  const requires = relativeRequiresOf(source)

  it('has relative requires to check (guard against a silently empty regex)', () => {
    expect(requires.length).toBeGreaterThan(0)
  })

  const copied = [...dockerfile.matchAll(/^COPY .* \.\/(\S+)$/gm)].map((match) => match[1].replace(/\/$/, ''))

  it.each(requires)('copies %s into the production image', (file) => {
    expect(existsSync(path.join(UI_ROOT, file)), `server.js requires ${file}, which does not exist`).toBe(true)
    const covered = copied.some((dest) => file === dest || file.startsWith(`${dest}/`))
    expect(covered, `deploy/Dockerfile must COPY ${file}: server.js requires it`).toBe(true)
  })
})
