import { existsSync } from 'node:fs'
import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import DurationSequencer from './config/vitest/duration-sequencer'

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
    projects: [
      { extends: true, test: { name: 'vm', include: SPEC_FILES, exclude: [...NEVER_SPECS, ...Object.keys(PROCESS_PER_FILE)] } },
      {
        extends: true,
        test: { name: 'process', pool: 'forks', include: Object.keys(PROCESS_PER_FILE), exclude: NEVER_SPECS },
      },
    ],
    css: false,
    // vmForks: measured 2026-11-10 on four cores, 489s against 800s for one fork per spec file.
    pool: 'vmForks',
    vmMemoryLimit: '1200MB',
    globals: true,
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: { settings: { navigation: { disableChildFrameNavigation: true } } },
    },
    testTimeout: 50000,
    hookTimeout: 50000,
    root: './',
    setupFiles: ['./config/vitest/polyfills.ts', './config/vitest/disk-inputs.ts', './config/vitest/vitest.setup.ts'],
    clearMocks: true,
    sequence: { sequencer: DurationSequencer },
    server: {
      deps: {
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
      'next/cache': path.resolve(__dirname, './node_modules/next/cache.js'),
    },
  },
})
