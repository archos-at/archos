/**
 * Imports the website's MDX posts (apps/website/src/content/blog) into the CMS,
 * keyed by slug, through Payload's Local API, and is safe to run again: a post
 * whose content already matches is left alone, one that differs is updated, one
 * the CMS lacks is created. Both languages of a post land in one document.
 *
 *   bun run import:blog                 # dry run: what would be created, updated, skipped
 *   bun run import:blog -- --apply      # write it
 *
 * Needs `DATABASE_URL` and `PAYLOAD_SECRET` of the CMS to write to (locally,
 * `task cms:import`). A post edited in the CMS since the import wrote it (its
 * content no longer matches `importHash`) is skipped and reported, unless
 * `--overwrite`: after the cutover the CMS is the source, and a re-run must not
 * undo an editor's work. `--content <dir>` reads another copy of the posts.
 *
 * The import runs as the system (no user): it publishes what the files say is
 * published, and asks for no LinkedIn drafts of old news.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '@payload-config';
import { getPayload, type Payload } from 'payload';
import { contentHash, fromPayload, LOCALES, pairPosts, readPosts, toRecord } from './lib/blog-posts.mjs';

type Locale = 'de' | 'en';
type Record_ = ReturnType<typeof toRecord>;

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  const args = { apply: false, overwrite: false, content: path.resolve(HERE, '../../website/src/content/blog') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--overwrite') args.overwrite = true;
    else if (argv[i] === '--content') args.content = path.resolve(argv[(i += 1)]);
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}

/** The CMS post that holds any of the record's slugs, newest draft included; two different posts is a conflict. */
async function findPost(payload: Payload, record: Record_) {
  const ids = new Set<number>();
  for (const [locale, fields] of Object.entries(record.locales) as [Locale, { slug: string }][]) {
    const found = await payload.find({ collection: 'posts', locale, draft: true, where: { slug: { equals: fields.slug } }, depth: 0, limit: 2 });
    for (const doc of found.docs) ids.add(doc.id);
  }
  if (ids.size > 1) throw new Error(`The slugs of one post belong to different CMS posts (${[...ids].join(', ')})`);
  const [id] = ids;
  return id === undefined ? undefined : payload.findByID({ collection: 'posts', id, locale: 'all', draft: true, depth: 0 });
}

type Step = { action: 'create' | 'update' | 'unchanged' | 'skip'; id?: number; reason?: string };

async function plan(payload: Payload, record: Record_, overwrite: boolean): Promise<Step> {
  const current = await findPost(payload, record);
  if (!current) return { action: 'create' };
  const now = contentHash(fromPayload(current));
  if (now === contentHash(record)) return { action: 'unchanged', id: current.id };
  const editedHere = current.importHash && current.importHash !== now;
  if (editedHere && !overwrite) return { action: 'skip', id: current.id, reason: 'edited in the CMS since the import' };
  return { action: 'update', id: current.id };
}

/** Writes a record: the shared fields with the first language, then each further language. */
async function write(payload: Payload, record: Record_, id?: number) {
  const draft = record.status === 'draft';
  const context = { skipSocialDrafts: true };
  const locales = LOCALES.filter((l) => l in record.locales) as Locale[];
  let postId = id;
  for (const [i, locale] of locales.entries()) {
    const data = { ...(i === 0 ? record.shared : {}), ...record.locales[locale], _status: record.status, importHash: contentHash(record) };
    if (postId === undefined) {
      postId = (await payload.create({ collection: 'posts', locale, data: data as never, draft, context })).id;
    } else {
      await payload.update({ collection: 'posts', id: postId, locale, data: (i === 0 ? data : { ...data, ...record.shared }) as never, draft, context });
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
  const records = pairPosts(readPosts(args.content)).map(toRecord);
  console.log(`${records.length} posts read from ${args.content}`);
  const payload = await getPayload({ config });
  const counts = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const record of records) {
    const step = await plan(payload, record, args.overwrite);
    counts[step.action] += 1;
    const slugs = Object.entries(record.locales).map(([l, f]) => `${l}/${(f as { slug: string }).slug}`).join(' + ');
    console.log(`  ${step.action.padEnd(9)} ${slugs}${step.reason ? ` (${step.reason})` : ''}`);
    if (args.apply && (step.action === 'create' || step.action === 'update')) await write(payload, record, step.id);
  }
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(args.apply ? `Applied: ${summary}.` : `Dry run: ${summary}. Pass --apply to write.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
