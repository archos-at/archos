import path from 'node:path'
import type { NextConfig } from 'next'
import { LEGACY_ROUTES } from './bff/api/legacy-routes'
import { AVATAR_IMAGE_PATTERNS } from './bff/images/avatar-hosts'
import { LOCAL_IMAGE_PATTERNS } from './bff/images/optimizable'
import { requestBodyLimitBytes } from './shared/config/request-body-limit'

const requestBodyLimitMB = Math.ceil(requestBodyLimitBytes(process.env) / (1024 * 1024))

export const nextConfig: NextConfig = {
  reactStrictMode: true,

  deploymentId: process.env.GIT_SHA?.trim() || undefined,

  agentRules: false,

  async redirects() {
    return [
      ...LEGACY_ROUTES.map(({ from, to }) => ({ source: from, destination: to, permanent: true })),
      { source: '/app/archiv', destination: '/app/office-shelf', permanent: true },
      { source: '/app/archiv/:path*', destination: '/app/office-shelf/:path*', permanent: true },
      { source: '/app/platform/norms', destination: '/app/platform/countries', permanent: true },
      { source: '/app/platform/knowledge', destination: '/app/platform/maintenance', permanent: true },
    ]
  },

  skipTrailingSlashRedirect: true,

  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },

  images: {
    remotePatterns: AVATAR_IMAGE_PATTERNS.map((pattern) => ({ ...pattern })),

    localPatterns: LOCAL_IMAGE_PATTERNS.map((pattern) => ({ ...pattern })),

    maximumDiskCacheSize: 0,

    minimumCacheTTL: 300,
  },

  serverExternalPackages: ['exceljs', 'ws', '@hatchet-dev/typescript-sdk'],

  experimental: {
    serverActions: {
      bodySizeLimit: `${requestBodyLimitMB}mb`,
    },
    proxyClientMaxBodySize: `${requestBodyLimitMB}mb`,
  },

  turbopack: {
    resolveAlias: {
      'laz-perf': './bff/bim/laz-perf-stub.ts',
      'laz-perf/lib/web/laz-perf.wasm?url': './bff/bim/laz-perf-stub.ts',
      'laz-perf/lib/web/laz-perf.wasm': './bff/bim/laz-perf-stub.ts',
    },
  },

  webpack: (config) => {
    config.resolve = config.resolve ?? {}
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'laz-perf': path.resolve(process.cwd(), 'bff/bim/laz-perf-stub.ts'),
      'laz-perf/lib/web/laz-perf.wasm': path.resolve(process.cwd(), 'bff/bim/laz-perf-stub.ts'),
    }
    return config
  },

  async rewrites() {
    return [{ source: '/api/archiv/:path*', destination: '/api/office-shelf/:path*' }]
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/api/knowledge-base/documents/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: '/api/platform/knowledge/documents/:fileName',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: '/api/documents/:id/file',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ]
  },
}

export const withSourceMaps = (
  config: NextConfig,
  env: Readonly<Record<string, string | undefined>> = process.env
): NextConfig =>
  env.EMIT_SOURCE_MAPS?.trim() === '1'
    ? {
        ...config,
        productionBrowserSourceMaps: true,
        experimental: { ...config.experimental, serverSourceMaps: true },
      }
    : config

export default function config(): NextConfig {
  return withSourceMaps(nextConfig)
}
