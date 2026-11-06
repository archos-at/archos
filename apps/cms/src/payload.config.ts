/**
 * The website's CMS (ADR-0155): Payload 3 in its own Next.js app, its own
 * Postgres, its files in SeaweedFS. Everything an agent or a reviewer needs to
 * know about the model, the rules and the hooks is in `src/`; this file wires
 * it together and reads the environment (docs/deployment/environment-variables.md,
 * "The website's CMS").
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { mcpPlugin } from '@payloadcms/plugin-mcp';
import { s3Storage } from '@payloadcms/storage-s3';
import { de } from '@payloadcms/translations/languages/de';
import { en } from '@payloadcms/translations/languages/en';
import { buildConfig } from 'payload';
import sharp from 'sharp';
import { canPublish } from './access/roles';
import { Authors } from './collections/authors';
import { Media } from './collections/media';
import { Posts } from './collections/posts';
import { SocialAccounts, SocialPosts } from './collections/social';
import { Users } from './collections/users';
import { draftSocialPostsTask } from './jobs/draft-social-posts';
import { MCP_OPTIONS } from './mcp';
import { migrations } from './migrations';
import { provision } from './provision';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const serverURL = env.CMS_PUBLIC_URL?.trim() || 'http://localhost:3100';
const s3Bucket = env.CMS_S3_BUCKET?.trim();

export default buildConfig({
  serverURL,
  secret: env.PAYLOAD_SECRET ?? '',
  telemetry: false,
  // Cookies are accepted from the CMS's own origin only; no browser elsewhere calls this API.
  csrf: [serverURL],
  cors: [],
  graphQL: { disable: true },
  admin: {
    user: Users.slug,
    meta: { titleSuffix: ' · CMS' },
    importMap: { baseDir: dirname },
    livePreview: {
      breakpoints: [
        { name: 'mobile', label: 'Mobile', width: 375, height: 812 },
        { name: 'desktop', label: 'Desktop', width: 1280, height: 900 },
      ],
    },
  },
  i18n: { supportedLanguages: { de, en }, fallbackLanguage: 'en' },
  localization: {
    locales: [
      { code: 'de', label: 'Deutsch' },
      { code: 'en', label: 'English' },
    ],
    defaultLocale: 'de',
    // A post without an English title has no English page; nothing borrows the German one.
    fallback: false,
  },
  collections: [Posts, Media, Authors, SocialPosts, SocialAccounts, Users],
  upload: { limits: { fileSize: 20_000_000 } },
  jobs: {
    tasks: [draftSocialPostsTask],
    // The scheduled publishes and the social drafts, run inside the server once a minute.
    autoRun: [{ cron: '* * * * *', limit: 20, queue: 'default' }],
    shouldAutoRun: () => env.CMS_JOBS_AUTORUN !== 'false',
    access: {
      cancel: ({ req }) => canPublish(req.user),
      queue: ({ req }) => canPublish(req.user),
      run: ({ req }) => canPublish(req.user),
    },
  },
  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URL ?? '', max: Number(env.DATABASE_POOL_MAX ?? 10) },
    migrationDir: path.resolve(dirname, 'migrations'),
    // Schema changes are migrations (`bun run payload migrate:create`), applied when a production server starts.
    push: false,
    prodMigrations: migrations,
  }),
  sharp,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  plugins: [
    mcpPlugin(MCP_OPTIONS),
    s3Storage({
      enabled: Boolean(s3Bucket),
      // The same schema with and without S3, so one migration chain serves both.
      alwaysInsertFields: true,
      collections: { media: true },
      bucket: s3Bucket ?? 'cms-files',
      config: {
        endpoint: env.CMS_S3_ENDPOINT,
        region: env.CMS_S3_REGION ?? 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: env.CMS_S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.CMS_S3_SECRET_ACCESS_KEY ?? '' },
      },
    }),
  ],
  onInit: async (payload) => {
    await provision(payload);
  },
});
