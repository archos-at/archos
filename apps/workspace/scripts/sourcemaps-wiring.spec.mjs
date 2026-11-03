// @disk-inputs: ../../.github/actions/build-image/action.yml, deploy/Dockerfile
/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
    const loaded = config()
    expect(loaded.productionBrowserSourceMaps).toBeUndefined()
    expect(loaded.experimental?.serverSourceMaps).toBeUndefined()
  })
})

describe('the image build wiring', () => {
  const dockerfile = readFileSync(path.join(UI_ROOT, 'deploy', 'Dockerfile'), 'utf8')
  const action = readFileSync(
    path.join(UI_ROOT, '..', '..', '.github', 'actions', 'build-image', 'action.yml'),
    'utf8'
  )
  const builder = dockerfile.slice(
    dockerfile.indexOf('FROM base AS builder'),
    dockerfile.indexOf('FROM scratch AS sourcemaps')
  )
  const buildRun = builder.slice(builder.lastIndexOf('RUN', builder.indexOf('bun run build')))
  const buildStep = buildRun.slice(0, buildRun.indexOf('\n\n'))

  it('emits maps and injects chunk ids into both served trees, without a release, so offline', () => {
    expect(buildStep).toContain('EMIT_SOURCE_MAPS=1 bun run build')
    expect(buildStep).toContain('posthog-cli sourcemap inject --directory .next/static')
    expect(buildStep).toContain('posthog-cli sourcemap inject --directory .next/server')
    expect(buildStep).not.toMatch(/--release-(name|version)/)
  })

  it('holds no PostHog key: no secret mount, no key argument, nothing passed by the action', () => {
    expect(dockerfile).not.toContain('--mount=type=secret')
    expect(dockerfile).not.toMatch(/^\s*(ARG|ENV)\s+\w*(API_KEY|KEY)\b/m)
    expect(action).not.toMatch(/posthog-api-key|POSTHOG_API_KEY|POSTHOG_CLI_API_KEY|secrets:/)
  })

  it('declares the commit before the build, for the deployment id and the release', () => {
    expect(builder.indexOf('ARG GIT_SHA=""')).toBeLessThan(builder.indexOf('bun run build'))
  })

  it('copies maps and their chunks aside before it deletes them from the served trees', () => {
    const copied = buildStep.indexOf('/sourcemaps/$map')
    expect(copied).toBeGreaterThan(buildStep.indexOf('sourcemap inject --directory .next/server'))
    expect(copied).toBeLessThan(buildStep.indexOf("-name '*.map' -type f -delete"))
  })

  it('deletes every map and sourceMappingURL in the served trees, and fails if one survives', () => {
    expect(buildStep).toContain("find .next/static .next/server -name '*.map' -type f -delete")
    expect(buildStep).toContain('sourceMappingURL=/d')
    expect(buildStep).toMatch(
      /if find \.next\/static \.next\/server -name '\*\.map' \| grep -q \.; then .*exit 1/
    )
    expect(buildStep).toMatch(/grep -rlq 'chunkId=' .*exit 1/s)
  })

  it('deletes the CLI binary it fetched, which the production install would not prune', () => {
    expect(buildStep).toContain('rm -rf node_modules/@posthog/cli/node_modules/.bin_real')
  })

  it('keeps the maps in a stage of their own that is not the default target', () => {
    const stages = [...dockerfile.matchAll(/^FROM .* AS (\w+)$/gm)].map((match) => match[1])
    expect(stages.at(-1)).toBe('runner')
    expect(stages).toContain('sourcemaps')
    expect(dockerfile).toMatch(/FROM scratch AS sourcemaps\nCOPY --from=builder \/sourcemaps \//)
  })

  it('exports that stage from the build-image action only when asked', () => {
    expect(action).toMatch(/if: inputs\.export-sourcemaps == 'true'\s+uses: docker\/build-push-action/)
    expect(action).toMatch(/target: sourcemaps/)
    expect(action).toMatch(/name: sourcemaps-frontend/)
  })
})
