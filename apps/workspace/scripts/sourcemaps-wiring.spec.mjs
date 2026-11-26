// @disk-inputs: ../../.github/actions/build-image/action.yml, deploy/Dockerfile
/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DockerfileParser } from 'dockerfile-ast'
import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import config, { nextConfig, withSourceMaps } from '../next.config.ts'

/**
 * Source maps for PostHog error tracking. The image build emits them, injects
 * chunk ids offline and keeps them in a `sourcemaps` stage; the Source maps
 * workflow uploads them after CI (docs/contributing/ci.md). What is held in
 * place here:
 *  - only the image build emits maps: a local build and the running server get
 *    the config exactly as written;
 *  - the build holds no key: the CLI injects without a release name, which
 *    contacts nobody, so a pull request build is the same build as a push;
 *  - maps and their injected chunks are copied aside before the served trees
 *    lose every map and every `sourceMappingURL`, because Next serves
 *    `.next/static` to anyone and a map carries the original source;
 *  - the `sourcemaps` stage never becomes the runtime image.
 */

const UI_ROOT = path.resolve(import.meta.dirname, '..')

describe('withSourceMaps', () => {
  it('turns browser and server maps on when the image build asks', () => {
    const configured = withSourceMaps(nextConfig, { EMIT_SOURCE_MAPS: ' 1 ' })
    expect(configured.productionBrowserSourceMaps).toBe(true)
    expect(configured.experimental?.serverSourceMaps).toBe(true)
    expect(configured.skipTrailingSlashRedirect).toBe(nextConfig.skipTrailingSlashRedirect)
  })

  it.each([['nothing', {}], ['another value', { EMIT_SOURCE_MAPS: '0' }]])(
    'leaves the config as written with %s',
    (_what, env) => {
      expect(withSourceMaps(nextConfig, env)).toBe(nextConfig)
    }
  )

  it('is what Next loads, with no map flags outside the image build', () => {
    const saved = process.env.EMIT_SOURCE_MAPS
    vi.stubEnv('EMIT_SOURCE_MAPS', undefined)
    try {
      const loaded = config()
      expect(loaded.productionBrowserSourceMaps).toBeUndefined()
      expect(loaded.experimental?.serverSourceMaps).toBeUndefined()
    } finally {
      if (saved !== undefined) vi.stubEnv('EMIT_SOURCE_MAPS', saved)
    }
  })
})

function stagesOf(dockerfile) {
  const stages = []
  for (const instruction of dockerfile.getInstructions()) {
    if (instruction.getKeyword() === 'FROM') stages.push({ from: instruction, instructions: [] })
    else stages.at(-1)?.instructions.push(instruction)
  }
  return stages
}

function copyOf(instruction) {
  return {
    from: instruction.getFlags().find((flag) => flag.getName() === 'from')?.getValue(),
    sources: instruction.getArguments().slice(0, -1).map((a) => a.getValue()),
    destination: instruction.getArguments().at(-1)?.getValue(),
  }
}

function keysAndStrings(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(keysAndStrings)
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysAndStrings(inner)])
  }
  return []
}

describe('the image build wiring', () => {
  const dockerfile = DockerfileParser.parse(readFileSync(path.join(UI_ROOT, 'deploy', 'Dockerfile'), 'utf8'))
  const action = parseYaml(
    readFileSync(path.join(UI_ROOT, '..', '..', '.github', 'actions', 'build-image', 'action.yml'), 'utf8')
  )
  const steps = action.runs.steps
  const stages = stagesOf(dockerfile)
  const stage = (name) => stages.find((s) => s.from.getBuildStage() === name)
  const builder = stage('builder').instructions
  const buildIndex = builder.findIndex(
    (i) => i.getKeyword() === 'RUN' && i.getArgumentsContent().includes('bun run build')
  )
  const buildStep = builder[buildIndex].getArgumentsContent()
  const instructions = dockerfile.getInstructions()
  const copies = instructions.filter((i) => i.getKeyword() === 'COPY').map(copyOf)
  const exportIf = "inputs.export-sourcemaps == 'true'"

  it('emits maps and injects chunk ids into both served trees, without a release, so offline', () => {
    expect(buildStep).toContain('EMIT_SOURCE_MAPS=1 bun run build')
    expect(buildStep).toContain('posthog-cli sourcemap inject --directory .next/static')
    expect(buildStep).toContain('posthog-cli sourcemap inject --directory .next/server')
    expect(buildStep).not.toContain('--release-name')
    expect(buildStep).not.toContain('--release-version')
  })

  it('holds no PostHog key: no secret mount, no key argument, nothing passed by the action', () => {
    const mounts = instructions
      .flatMap((i) => i.getFlags?.() ?? [])
      .filter((flag) => flag.getName() === 'mount')
      .map((flag) => flag.getValue())
    expect(mounts.filter((mount) => mount?.includes('type=secret'))).toEqual([])
    const declared = instructions
      .filter((i) => i.getKeyword() === 'ARG' || i.getKeyword() === 'ENV')
      .flatMap((i) => i.getProperties().map((property) => property.getName()))
    expect(declared.length).toBeGreaterThan(0)
    expect(declared.filter((name) => name.endsWith('KEY'))).toEqual([])
    const words = keysAndStrings(action)
    expect(Object.keys(action.inputs)).toContain('export-sourcemaps')
    expect(words).not.toContain('secrets')
    for (const key of ['posthog-api-key', 'POSTHOG_API_KEY', 'POSTHOG_CLI_API_KEY']) {
      expect(words.filter((word) => word.includes(key)), key).toEqual([])
    }
  })

  it('declares the commit before the build, for the deployment id and the release', () => {
    const sha = builder.findIndex((i) => i.getKeyword() === 'ARG' && i.getArgumentsContent() === 'GIT_SHA=""')
    expect(sha).toBeGreaterThanOrEqual(0)
    expect(sha).toBeLessThan(buildIndex)
  })

  it('fails the build when a map or its chunk cannot be copied aside', () => {
    expect(buildStep).toContain('cp "$map" "/sourcemaps/$map" || exit 1')
    expect(buildStep).toContain('cp "${map%.map}" "/sourcemaps/${map%.map}" || exit 1')
  })

  it('copies maps and their chunks aside before it deletes them from the served trees', () => {
    const copied = buildStep.indexOf('/sourcemaps/$map')
    expect(copied).toBeGreaterThan(buildStep.indexOf('sourcemap inject --directory .next/server'))
    expect(copied).toBeLessThan(buildStep.indexOf("-name '*.map' -type f -delete"))
  })

  it('deletes every map and sourceMappingURL in the served trees, and fails if one survives', () => {
    expect(buildStep).toContain("find .next/static .next/server -name '*.map' -type f -delete")
    expect(buildStep).toContain('sourceMappingURL=/d')
    const survivor = "if find .next/static .next/server -name '*.map' | grep -q .; then "
    expect(buildStep).toContain(survivor)
    const then = buildStep.indexOf(survivor) + survivor.length
    expect(buildStep.slice(then, buildStep.indexOf('fi', then))).toContain('exit 1')
    expect(buildStep).toContain("[ ! -d /sourcemaps/static ] || grep -rL 'chunkId=' --include='*.js' /sourcemaps | grep -q .")
  })

  it('ships no node_modules from the builder, where the CLI fetched its binary', () => {
    expect(copies.filter((copy) => copy.from === 'builder' && copy.sources.includes('/app/node_modules'))).toEqual([])
  })

  it('keeps the maps in a stage of their own that is not the default target', () => {
    const names = stages.map((s) => s.from.getBuildStage())
    expect(names.at(-1)).toBe('runner')
    expect(names).toContain('sourcemaps')
    const sourcemaps = stage('sourcemaps')
    expect(sourcemaps.from.getImage()).toBe('scratch')
    expect(sourcemaps.instructions[0].getKeyword()).toBe('COPY')
    expect(copyOf(sourcemaps.instructions[0])).toEqual({ from: 'builder', sources: ['/sourcemaps'], destination: '/' })
  })

  it('exports that stage from the build-image action only when asked', () => {
    const exporting = steps.filter((step) => step.if === exportIf)
    const build = exporting.find((step) => step.uses?.startsWith('docker/build-push-action@'))
    expect(build?.with?.target).toBe('sourcemaps')
    expect(steps.filter((step) => step.with?.target === 'sourcemaps')).toEqual([build])
    const kept = steps.find((step) => step.with?.name === 'sourcemaps-frontend')
    expect(kept?.if).toBe(exportIf)
  })
})
