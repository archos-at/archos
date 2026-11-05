#!/usr/bin/env node
/**
 * Imports the website's MDX posts into the CMS, keyed by slug, and is safe to
 * run again: a post whose record already matches is left alone, one that
 * differs is updated in place, and one the CMS lacks is created.
 *
 *   node scripts/import-blog.mjs                  # offline: convert and validate every post, print the plan
 *   DIRECTUS_URL=… DIRECTUS_IMPORT_TOKEN=… \
 *     node scripts/import-blog.mjs                # dry run against the CMS: what would be created or updated
 *   … node scripts/import-blog.mjs --apply        # write it
 *
 * A post a person has edited in the CMS since the import wrote it is skipped
 * and reported, unless `--overwrite`: after the cutover the CMS is the source,
 * and a re-run must not undo an editor's work.
 *
 * The token needs create and update on the blog collections (an administrator's,
 * or one holding both content policies). `--content <dir>` points at another
 * copy of apps/website/src/content/blog.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparable, pairPosts, POST_FIELDS, readPosts, stableJson, toRecord, updateBody } from './lib/blog-posts.mjs';
import { directusFromEnv, query } from './lib/directus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTENT = path.resolve(HERE, '../../website/src/content/blog');

function parseArgs(argv) {
  const args = { apply: false, overwrite: false, content: DEFAULT_CONTENT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--overwrite') args.overwrite = true;
    else if (argv[i] === '--content') args.content = path.resolve(argv[(i += 1)]);
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}


/** The CMS post that holds any of `slugs`, or undefined; two different posts is a conflict. */
async function findPost(cms, slugs) {
  const rows = await cms.get(`/items/blog_posts_translations${query({ filter: { slug: { _in: slugs } }, fields: 'slug,blog_posts_id', limit: -1 })}`);
  const ids = [...new Set(rows.map((r) => r.blog_posts_id))];
  if (ids.length > 1) throw new Error(`Slugs ${slugs.join(', ')} belong to different CMS posts (${ids.join(', ')})`);
  if (ids.length === 0) return undefined;
  return cms.get(`/items/blog_posts/${ids[0]}${query({ fields: POST_FIELDS.join(',') })}`);
}

/** What to do with one desired record, and why. */
async function plan(cms, record, importer, overwrite) {
  const slugs = record.translations.map((t) => t.slug);
  const current = await findPost(cms, slugs);
  if (!current) return { action: 'create', slugs, body: record };
  if (stableJson(comparable(current)) === stableJson(comparable(record))) return { action: 'unchanged', slugs };
  const editedByPerson = current.user_updated && current.user_updated !== importer;
  if (editedByPerson && !overwrite) return { action: 'skip', slugs, reason: `edited in the CMS by ${current.user_updated}` };
  return { action: 'update', slugs, id: current.id, body: updateBody(current, record) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = pairPosts(readPosts(args.content)).map(toRecord);
  console.log(`${records.length} posts read from ${args.content}`);
  if (!process.env.DIRECTUS_URL) {
    for (const r of records) {
      const blocks = r.translations.reduce((n, t) => n + t.blocks.length, 0);
      console.log(`  ${r.status.padEnd(9)} ${r.translations.map((t) => `${t.languages_code}/${t.slug}`).join(' + ')} (${blocks} blocks)`);
    }
    console.log('Offline: every post converted. Set DIRECTUS_URL and DIRECTUS_IMPORT_TOKEN to compare with a CMS.');
    return;
  }
  const cms = directusFromEnv('DIRECTUS_IMPORT_TOKEN');
  const importer = (await cms.get('/users/me?fields=id')).id;
  const counts = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const record of records) {
    const step = await plan(cms, record, importer, args.overwrite);
    counts[step.action] += 1;
    console.log(`  ${step.action.padEnd(9)} ${step.slugs.join(' + ')}${step.reason ? ` (${step.reason})` : ''}`);
    if (!args.apply) continue;
    if (step.action === 'create') await cms.post('/items/blog_posts', step.body);
    if (step.action === 'update') await cms.patch(`/items/blog_posts/${step.id}`, step.body);
  }
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(args.apply ? `Applied: ${summary}.` : `Dry run: ${summary}. Pass --apply to write.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
