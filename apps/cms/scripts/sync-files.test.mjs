/**
 * The committed sync files (`directus/default`) hold what the ADR promises:
 * the choices the website reads from code match the code, no agent or token can
 * publish, and the MCP server cannot delete. Each of these is a property a
 * Studio edit followed by `d6s sync pull` could quietly break.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYNC = path.resolve(HERE, '../directus/default');
const WEBSITE = path.resolve(HERE, '../../website');

function syncFile(kind, prefix) {
  const dir = path.join(SYNC, kind);
  const name = readdirSync(dir).find((f) => f.startsWith(`${prefix}_`));
  assert.ok(name, `${kind}/${prefix}_*.json exists`);
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
}

const choicesOf = (collection, field) => {
  const schema = syncFile('schema', collection.replace(/_/g, '-'));
  const meta = schema.fields.find((f) => f.field === field).meta;
  return meta.options.choices.map((c) => c.value);
};

const records = (prefix) => syncFile('data', prefix).records;

test('the cover choices are the drawings in apps/website/src/assets/covers', () => {
  const drawings = readdirSync(path.join(WEBSITE, 'src/assets/covers'))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.replace(/\.svg$/, ''))
    .sort();
  assert.deepEqual([...choicesOf('blog_posts', 'cover')].sort(), drawings);
});

test('the category choices are CATEGORY_IDS of apps/website/src/lib/categories.ts', () => {
  const source = readFileSync(path.join(WEBSITE, 'src/lib/categories.ts'), 'utf8');
  const ids = /CATEGORY_IDS\s*=\s*\[([^\]]*)\]/.exec(source)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(choicesOf('blog_posts', 'category'), ids);
});

test('every permission belongs to a policy in the sync files', () => {
  const policies = new Set(records('directus-policies').map((p) => p.id));
  for (const permission of records('directus-permissions')) {
    assert.ok(policies.has(permission.policy), `permission ${permission.id} names a known policy`);
  }
});

test('only people can publish: the publishing policy is held by the Publisher role and nothing else', () => {
  const policy = records('directus-policies').find((p) => p.name === 'Content publishing');
  const roles = new Map(records('directus-roles').map((r) => [r.id, r.name]));
  const holders = records('directus-access').filter((a) => a.policy === policy.id);
  assert.deepEqual(holders.map((a) => (a.user ? `user ${a.user}` : roles.get(a.role))), ['Publisher']);
});

test('drafting can neither publish a blog post nor approve a social post', () => {
  const drafting = records('directus-policies').find((p) => p.name === 'Content drafting').id;
  const writes = records('directus-permissions').filter(
    (p) => p.policy === drafting && ['create', 'update'].includes(p.action) && ['blog_posts', 'social_posts'].includes(p.collection),
  );
  assert.equal(writes.length, 4);
  for (const permission of writes) {
    assert.deepEqual(permission.validation, { status: { _in: ['draft', 'in_review'] } }, `${permission.collection} ${permission.action}`);
  }
});

test('the public and the website read only what is live', () => {
  const names = new Map(records('directus-policies').map((p) => [p.id, p.name]));
  const readers = records('directus-permissions').filter((p) => ['$t:public_label', 'Website reader'].includes(names.get(p.policy)));
  for (const permission of readers) {
    assert.equal(permission.action, 'read', `${names.get(permission.policy)} ${permission.collection}`);
  }
  const posts = readers.filter((p) => p.collection === 'blog_posts');
  assert.equal(posts.length, 2);
  for (const permission of posts) {
    assert.deepEqual(permission.permissions, { _and: [{ status: { _eq: 'published' } }, { publish_date: { _lte: '$NOW' } }] });
  }
});

test('the MCP server is on, signs agents in as their person, and cannot delete', () => {
  const [settings] = records('directus-settings');
  assert.equal(settings.mcp_enabled, true);
  assert.equal(settings.mcp_oauth_enabled, true);
  assert.equal(settings.mcp_allow_deletes, false);
  assert.equal(settings.public_registration, false);
});

test('images are transformed only through the named presets', () => {
  const [settings] = records('directus-settings');
  assert.equal(settings.storage_asset_transform, 'presets');
  const keys = settings.storage_asset_presets.map((p) => p.key);
  assert.ok(keys.includes('share'), 'the share card preset exists');
  const share = settings.storage_asset_presets.find((p) => p.key === 'share');
  assert.deepEqual([share.width, share.height, share.format], [1200, 630, 'jpg']);
});
