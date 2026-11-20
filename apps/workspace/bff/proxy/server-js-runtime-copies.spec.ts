// @disk-inputs: deploy/Dockerfile, observability/http-metrics.js, observability/otel-metrics.js, server.js, bff/boot-line.js, bff/limits/factory.js, bff/limits/rules.js, bff/limits/ws-frames.js, bff/proxy/backend-target.js, bff/proxy/ws-teardown.js, bff/proxy/ws-upgrade-headers.js, bff/redis/connect.js, bff/turns/turn-headers.js
/**
 * @vitest-environment node
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DockerfileParser, From, ModifiableInstruction, type Instruction } from 'dockerfile-ast'
import { describe, expect, it } from 'vitest'
import { importsOf, parseSource, ts } from '@/test-utils/source-ast'

const UI_ROOT = path.resolve(__dirname, '../..')

function relativeRequiresOf(source: ts.SourceFile): string[] {
  return importsOf(source)
    .filter(
      ({ node, specifier }) =>
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        specifier.startsWith('./'),
    )
    .map(({ specifier }) => specifier.slice('./'.length))
}

function instructionsOf(): Instruction[] {
  return DockerfileParser.parse(readFileSync(path.join(UI_ROOT, 'deploy', 'Dockerfile'), 'utf8')).getInstructions()
}

function argumentsOf(instruction: Instruction): string[] {
  return instruction.getArguments().map((argument) => argument.getValue())
}

function flagOf(instruction: Instruction, name: string): string | null | undefined {
  if (!(instruction instanceof ModifiableInstruction)) return undefined
  return instruction.getFlags().find((flag) => flag.getName() === name)?.getValue()
}

describe('server.js runtime image copies', () => {
  const requires = relativeRequiresOf(parseSource('server.js', UI_ROOT))

  it('has relative requires to check (guard against a silently empty parse)', () => {
    expect(requires.length).toBeGreaterThan(0)
  })

  const copied = instructionsOf()
    .filter((instruction) => instruction.getKeyword() === 'COPY')
    .map((instruction) => argumentsOf(instruction).at(-1) ?? '')
    .filter((destination) => destination.startsWith('./') && destination.length > './'.length)
    .map((destination) => {
      const dest = destination.slice('./'.length)
      return dest.endsWith('/') ? dest.slice(0, -1) : dest
    })

  it.each(requires)('copies %s into the production image', (file) => {
    expect(existsSync(path.join(UI_ROOT, file)), `server.js requires ${file}, which does not exist`).toBe(true)
    const covered = copied.some((dest) => file === dest || file.startsWith(`${dest}/`))
    expect(covered, `deploy/Dockerfile must COPY ${file}: server.js requires it`).toBe(true)
  })
})

function stage(instructions: Instruction[], name: string): Instruction[] {
  const start = instructions.findIndex((instruction) => instruction instanceof From && instruction.getBuildStage() === name)
  expect(start, `deploy/Dockerfile has no stage ${name}`).toBeGreaterThanOrEqual(0)
  const end = instructions.findIndex((instruction, index) => index > start && instruction instanceof From)
  return instructions.slice(start, end === -1 ? undefined : end)
}

describe('runtime image layers', () => {
  const instructions = instructionsOf()

  it('installs the production dependencies from the lockfile inputs alone', () => {
    const sources = stage(instructions, 'prod-deps')
      .filter((instruction) => instruction.getKeyword() === 'COPY')
      .flatMap((instruction) => argumentsOf(instruction).slice(0, -1))
    expect(sources.sort()).toEqual(['bun.lock', 'package.json', 'patches'])
  })

  it('ships node_modules from prod-deps, before the build output', () => {
    const runner = stage(instructions, 'runner')
    const modules = runner.findIndex(
      (instruction) =>
        instruction.getKeyword() === 'COPY' &&
        flagOf(instruction, 'from') === 'prod-deps' &&
        argumentsOf(instruction).join(' ') === '/app/node_modules ./node_modules',
    )
    const nextOutput = runner.findIndex((instruction) => argumentsOf(instruction).includes('/app/.next'))
    expect(modules, 'the runner must COPY node_modules from prod-deps').toBeGreaterThanOrEqual(0)
    expect(modules).toBeLessThan(nextOutput)
    expect(runner.filter((instruction) => argumentsOf(instruction).some((arg) => arg.includes('./node_modules')))).toHaveLength(1)
  })

  it('sets GIT_SHA after every layer of the runner', () => {
    const runner = stage(instructions, 'runner')
    const sha = runner.findIndex(
      (instruction) => instruction.getKeyword() === 'ARG' && argumentsOf(instruction)[0]?.startsWith('GIT_SHA'),
    )
    const lastLayer = runner.findLastIndex((instruction) => ['COPY', 'RUN', 'ADD'].includes(instruction.getKeyword()))
    expect(sha).toBeGreaterThan(lastLayer)
  })
})
