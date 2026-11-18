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

function stage(dockerfile: string, name: string): string[] {
  const lines = dockerfile.split('\n')
  const start = lines.findIndex((line) => new RegExp(`^FROM \\S+ AS ${name}$`).test(line))
  expect(start, `deploy/Dockerfile has no stage ${name}`).toBeGreaterThanOrEqual(0)
  const end = lines.findIndex((line, index) => index > start && line.startsWith('FROM '))
  return lines.slice(start, end === -1 ? undefined : end).filter((line) => line && !line.startsWith('#'))
}

describe('runtime image layers', () => {
  const dockerfile = readFileSync(path.join(UI_ROOT, 'deploy', 'Dockerfile'), 'utf8')

  it('installs the production dependencies from the lockfile inputs alone', () => {
    const sources = stage(dockerfile, 'prod-deps')
      .filter((line) => line.startsWith('COPY '))
      .flatMap((line) => line.split(/\s+/).slice(1, -1))
    expect(sources.sort()).toEqual(['bun.lock', 'package.json', 'patches'])
  })

  it('ships node_modules from prod-deps, before the build output', () => {
    const runner = stage(dockerfile, 'runner')
    const modules = runner.findIndex((line) => /^COPY --from=prod-deps .* \/app\/node_modules \.\/node_modules$/.test(line))
    const nextOutput = runner.findIndex((line) => line.includes('/app/.next '))
    expect(modules, 'the runner must COPY node_modules from prod-deps').toBeGreaterThanOrEqual(0)
    expect(modules).toBeLessThan(nextOutput)
    expect(runner.filter((line) => line.includes('./node_modules'))).toHaveLength(1)
  })

  it('sets GIT_SHA after every layer of the runner', () => {
    const runner = stage(dockerfile, 'runner')
    const sha = runner.findIndex((line) => line.startsWith('ARG GIT_SHA'))
    const lastLayer = runner.findLastIndex((line) => /^(COPY|RUN|ADD) /.test(line))
    expect(sha).toBeGreaterThan(lastLayer)
  })
})
