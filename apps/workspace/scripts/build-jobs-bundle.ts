import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface BunResolveArgs {
  readonly path: string
  readonly resolveDir: string
}
type BunResolved = { path: string; namespace?: string; external?: boolean }
interface BunPluginBuilder {
  onResolve(options: { filter: RegExp }, resolve: (args: BunResolveArgs) => BunResolved): void
  onLoad(options: { filter: RegExp; namespace: string }, load: () => { contents: string; loader: 'js' }): void
}
interface BunPlugin {
  readonly name: string
  setup(build: BunPluginBuilder): void
}
declare const Bun: {
  build(options: Record<string, unknown>): Promise<{ success: boolean; logs: readonly unknown[]; outputs: readonly { path: string }[] }>
  resolveSync(specifier: string, from: string): string
}

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRIES = [
  { entry: path.join(UI_ROOT, 'bff/jobs-queue/slice-entry.ts'), naming: 'slice.mjs' },
  { entry: path.join(UI_ROOT, 'scripts/knowledge-carry.ts'), naming: 'knowledge-carry.mjs' },
] as const
const INLINED_PACKAGES = /^@workos-inc\/authkit-nextjs$/

const nextHostShims: BunPlugin = {
  name: 'next-host-shims',
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty-module' }))
    build.onLoad({ filter: /.*/, namespace: 'empty-module' }, () => ({ contents: 'export {}', loader: 'js' }))
    build.onResolve({ filter: /^next\/[a-z-]+$/ }, (args) => ({ path: `${args.path}.js`, external: true }))
    build.onResolve({ filter: INLINED_PACKAGES }, (args) => ({ path: Bun.resolveSync(args.path, args.resolveDir) }))
  },
}

async function buildJobsBundle(outdir: string, entry: string, naming: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    packages: 'external',
    outdir,
    naming,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [nextHostShims],
    throw: false,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error('the jobs bundle did not build')
  }
  return result.outputs[0].path
}

const flag = process.argv.indexOf('--outdir')
const outdir = path.resolve(flag > 0 ? process.argv[flag + 1] : path.join(UI_ROOT, 'dist-jobs'))
for (const { entry, naming } of ENTRIES) {
  const file = await buildJobsBundle(outdir, entry, naming)
  console.log(`[jobs-bundle] wrote ${path.relative(process.cwd(), file)} (${(statSync(file).size / 1e6).toFixed(1)} MB)`)
}
