import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { APP_VIEWS } from '../bff/agent-api/catalog/app-views'

interface BunResolveArgs {
  readonly path: string
  readonly importer: string
}
interface BunPlugin {
  readonly name: string
  setup(build: { onResolve(options: { filter: RegExp }, resolve: (args: BunResolveArgs) => { path: string } | undefined): void }): void
}
interface BunBuildOutput {
  readonly path: string
  text(): Promise<string>
}
declare const Bun: {
  build(options: Record<string, unknown>): Promise<{ success: boolean; logs: readonly unknown[]; outputs: readonly BunBuildOutput[] }>
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const VIEWS = APP_VIEWS.map((view) => ({
  file: view.file,
  title: view.title,
  entry: `ui/features/mcp-apps/${view.name}/main.tsx`,
  css: `ui/features/mcp-apps/${view.name}/view.css`,
}))

const inlineScript = (code: string): string => code.replace(/<\/script/gi, '<\\/script')
const inlineStyle = (css: string): string => css.replace(/<\/style/gi, '<\\/style')

const STAND_INS: ReadonlyArray<{ filter: RegExp; path: string }> = [
  { filter: /MarkdownRenderer\/MarkdownRenderer$/, path: 'ui/features/mcp-apps/markdown-stand-in.tsx' },
]

const standIns: BunPlugin = {
  name: 'mcp-app-view-stand-ins',
  setup(build) {
    for (const { filter, path } of STAND_INS) {
      build.onResolve({ filter }, () => ({ path: join(ROOT, path) }))
    }
  },
}

async function bundleScript(entry: string): Promise<{ js: string; css: string }> {
  const result = await Bun.build({
    entrypoints: [join(ROOT, entry)],
    target: 'browser',
    format: 'esm',
    minify: true,
    splitting: false,
    sourcemap: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig: join(ROOT, 'tsconfig.json'),
    plugins: [standIns],
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`could not bundle ${entry}`)
  }
  const js: string[] = []
  const css: string[] = []
  for (const output of result.outputs) {
    if (output.path.endsWith('.js')) js.push(await output.text())
    else if (output.path.endsWith('.css')) css.push(await output.text())
  }
  if (js.length !== 1) throw new Error(`${entry} bundled to ${js.length} scripts, not one`)
  return { js: js[0] as string, css: css.join('\n') }
}

async function compileStyles(file: string): Promise<string> {
  const from = join(ROOT, file)
  const source = await readFile(from, 'utf8')
  const result = await postcss([tailwind({ base: dirname(from), optimize: { minify: true } })]).process(source, { from })
  return result.css
}

function documentOf(title: string, js: string, css: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${inlineStyle(css)}</style>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script type="module">${inlineScript(js)}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

async function main(): Promise<void> {
  const at = process.argv.indexOf('--out')
  const outDir = at > 0 && process.argv[at + 1] ? resolve(process.argv[at + 1] as string) : join(ROOT, 'mcp-app-views')
  await mkdir(outDir, { recursive: true })
  for (const view of VIEWS) {
    const started = Date.now()
    const [{ js, css: bundledCss }, css] = await Promise.all([bundleScript(view.entry), compileStyles(view.css)])
    const html = documentOf(view.title, js, `${css}\n${bundledCss}`)
    await writeFile(join(outDir, view.file), html)
    const kib = (Buffer.byteLength(html) / 1024).toFixed(0)
    console.log(`mcp-app-views: ${view.file} ${kib} KiB in ${Date.now() - started} ms`)
  }
}

await main()
