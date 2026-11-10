import { existsSync } from 'node:fs'
import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import DurationSequencer from './config/vitest/duration-sequencer'

/** What vitest collects; `_VITEST_INCLUDE` in ci/pr_selection.py mirrors it. */
const SPEC_FILES = [
  '{app,bff,ui,i18n,shared,types,utils}/**/*.{spec,test}.{ts,tsx}',
  '*.{spec,test}.{ts,tsx}',
  'tests/**/*.{spec,test}.{ts,tsx}',
  'purger/**/*.spec.mjs',
  'observability/**/*.spec.mjs',
  'workers/**/*.spec.mjs',
  'scripts/**/*.spec.mjs',
  'eslint-rules/**/*.spec.mjs',
]
const NEVER_SPECS = ['**/mocks/**', '**/node_modules/**']

/**
 * The spec files that keep a process of their own (the `forks` pool), each with
 * what a vm context breaks for it. Everything else runs in the vm pool. A spec
 * joins this list with its reason, and leaves it when the reason is gone.
 */
const PROCESS_PER_FILE: Record<string, string> = {
  'bff/feedback/export-workbook.spec.ts': 'exceljs requires uuid, an ES module the vm loader reads as CommonJS',
  'bff/search/plan-list-export.spec.ts': 'exceljs, as above',
  'app/api/platform/answer-feedback/export/route.spec.ts': 'exceljs, as above',
  'ui/features/diagrams/map-svg.spec.ts': 'mermaid imports khroma by directory, which the vm loader does not resolve',
  'ui/features/diagrams/parse-mermaid.spec.ts': 'khroma, as above',
  'bff/malware-scan/fake.spec.ts': 'net sockets hand back Buffers of the outer realm, which the fake refuses',
  'ui/features/documents/hooks/use-file-upload.spec.ts': 'the abort is told apart by its DOMException, another realm here',
}

const gone = Object.keys(PROCESS_PER_FILE).filter((spec) => !existsSync(`${__dirname}/${spec}`))
if (gone.length > 0) throw new Error(`PROCESS_PER_FILE in vitest.config.ts names specs that no longer exist: ${gone.join(', ')}`)

export default defineConfig({
  plugins: [react()],
  test: {
    // `include` and `exclude` are stated per project and nowhere above them: a
    // project that extends this config ADDS its lists to the ones here, so a
    // root-level `include` made both projects run every spec (3,737 files run
    // where there are 1,870).
    projects: [
      { extends: true, test: { name: 'vm', include: SPEC_FILES, exclude: [...NEVER_SPECS, ...Object.keys(PROCESS_PER_FILE)] } },
      {
        extends: true,
        test: { name: 'process', pool: 'forks', include: Object.keys(PROCESS_PER_FILE), exclude: NEVER_SPECS },
      },
    ],
    css: false,
    /**
     * One worker process runs many spec files, each in a fresh vm context.
     *
     * The default pool forks a process per spec file: 1,847 process starts,
     * each paying the setup files and the DOM again. Measured 2026-11-10 on
     * four cores, the whole suite: 800s and 2,310 CPU seconds with forks,
     * against the vm pool's 489s and 1,559. A context is a realm of its own,
     * so a spec still cannot see another's globals, modules or mocks; what
     * they do share is the process, which `config/vitest/polyfills.ts` resets
     * (`process.env`).
     *
     * Contexts are not fully collected, so a worker's heap grows with every
     * file: the first full run lost eleven workers to the heap limit. Past
     * `vmMemoryLimit` a worker is replaced after its file, before it can die
     * in the middle of one.
     */
    pool: 'vmForks',
    vmMemoryLimit: '1200MB',
    globals: true,
    environment: 'happy-dom',
    /**
     * Do not let happy-dom actually LOAD an `<iframe>`'s src.
     *
     * happy-dom treats an iframe as a real navigation and fires a network
     * request for it. Nothing in this suite wants that — the specs assert on
     * the `src` attribute, not on what a document server would return — and it
     * is not merely wasteful: the request outlives the test, so teardown aborts
     * it mid-flight, and that abort path (`Fetch.onAsyncTaskManagerAbort` →
     * `ClientRequest.destroy`) trips a libuv assertion that takes the whole
     * worker fork down with `Worker exited unexpectedly`. The run then reports
     * every remaining test as passed while silently never running one file's
     * worth of them.
     *
     * The symptom was visible long before it was fatal: the suite has been
     * printing `ECONNREFUSED 127.0.0.1:3000` and aborted-fetch stack traces
     * from the PDF-viewer specs for as long as those specs have rendered a
     * frame. It only became a crash once enough specs did it at once.
     */
    environmentOptions: {
      happyDOM: { settings: { navigation: { disableChildFrameNavigation: true } } },
    },
    testTimeout: 50000,
    root: './',
    setupFiles: ['./config/vitest/polyfills.ts', './config/vitest/disk-inputs.ts', './config/vitest/vitest.setup.ts'],
    clearMocks: true,
    // Shards by recorded time (tests/vitest-durations.json), not file count.
    sequence: { sequencer: DurationSequencer },
    server: {
      deps: {
        // `@workos-inc/authkit-nextjs` is inlined so Vite resolves its imports
        // rather than Node: its ESM build imports `next/cache` with no file
        // extension, which Node's ESM resolver rejects ("Did you mean to import
        // next/cache.js?"), and every spec that transitively reaches authkit
        // then fails to LOAD rather than to assert. Vite is fine with the
        // specifier, which is why the app build never saw this.
        inline: [/@nvidia/, /@workos-inc\/authkit-nextjs/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'cobertura', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'config/**',
        '**/*.{spec,test}.{ts,tsx}',
        '**/mocks/**',
        '**/test-utils/**',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@/app': path.resolve(__dirname, './app'),
      '@/lib': path.resolve(__dirname, './bff'),
      '@/features': path.resolve(__dirname, './ui/features'),
      '@/components': path.resolve(__dirname, './ui/components'),
      '@/hooks': path.resolve(__dirname, './ui/hooks'),
      '@/styles': path.resolve(__dirname, './ui/styles'),
      '@/adapters': path.resolve(__dirname, './ui/adapters'),
      '@/i18n': path.resolve(__dirname, './i18n'),
      '@/shared': path.resolve(__dirname, './shared'),
      '@/types': path.resolve(__dirname, './types'),
      '@/utils': path.resolve(__dirname, './utils'),
      '@/test-utils': path.resolve(__dirname, './tests/test-utils'),
      '@/mocks': path.resolve(__dirname, './tests/mocks'),
      'server-only': path.resolve(
        __dirname,
        './config/vitest/mocks/server-only.ts',
      ),
      'external-svg-loader': path.resolve(
        __dirname,
        './config/vitest/mocks/external-svg-loader.ts',
      ),
      'external-svg-loader/dist/svg-loader.min.js': path.resolve(
        __dirname,
        './config/vitest/mocks/external-svg-loader.ts',
      ),
      // `@workos-inc/authkit-nextjs`'s ESM build imports `next/cache` without a
      // file extension. Node's ESM resolver requires one, so every spec that
      // transitively reaches authkit fails to load — not with an assertion, but
      // with "Cannot find module … Did you mean to import next/cache.js?".
      //
      // Next ships the file; only the specifier is short. Vite's own resolver
      // is fine with it in the app build, which is why this surfaces in vitest
      // alone and why the fix belongs here rather than in a stub: nothing about
      // authkit's BEHAVIOUR needs replacing, just the extension.
      'next/cache': path.resolve(__dirname, './node_modules/next/cache.js'),
    },
  },
})
