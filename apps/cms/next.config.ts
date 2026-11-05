import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // The image runs `node server.js` from the standalone output (Dockerfile).
  output: 'standalone',
  poweredByHeader: false,
  // `next dev` would otherwise write its agent advice into AGENTS.md (as in apps/workspace).
  agentRules: false,
  turbopack: { root: path.resolve(dirname) },
  // The root `/` has no page of its own: the admin panel is the CMS.
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
    // The admin panel is framed by nobody; it frames the website's preview page.
    { source: '/admin/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
  ],
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
