import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: path.resolve(dirname) },
  redirects: async () => [{ source: '/', destination: '/admin', permanent: false }],
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    },
    { source: '/admin/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
  ],
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
