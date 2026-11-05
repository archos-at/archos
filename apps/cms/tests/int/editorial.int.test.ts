/**
 * The review step on a real database (ADR-0155), through the same operations
 * the admin panel, REST and the MCP plugin run: `overrideAccess: false` with a
 * user is how each of them calls Payload.
 *
 * Run by `bun run test:db` (scripts/test-db.sh), which migrates a throwaway
 * Postgres first. Skipped without CMS_TEST_DATABASE_URL.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPayload, type Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { paragraph, root } from '../../scripts/lib/lexical.mjs';

const DATABASE = process.env.CMS_TEST_DATABASE_URL;
type User = { id: number; role: string; collection: 'users' };

describe.skipIf(!DATABASE)('blog posts on Postgres', () => {
  let payload: Payload;
  let website: Server;
  const revalidations: string[] = [];
  const users = {} as Record<'admin' | 'publisher' | 'editor' | 'agent' | 'website' | 'handoff', User>;
  const as = (who: keyof typeof users) => ({ user: users[who], overrideAccess: false });

  const post = (title: string, extra: Record<string, unknown> = {}) => ({
    title,
    description: `${title}, described.`,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category: 'product' as const,
    coverType: 'drawing' as const,
    cover: 'welcome' as const,
    publishedAt: '2026-01-02T00:00:00.000Z',
    body: root([paragraph([{ type: 'text', version: 1, detail: 0, format: 0, mode: 'normal', style: '', text: 'Hello.' }])]),
    ...extra,
  });

  beforeAll(async () => {
    website = createServer((req, res) => {
      revalidations.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      res.statusCode = 204;
      res.end();
    });
    await new Promise<void>((resolve) => website.listen(0, '127.0.0.1', resolve));
    process.env.WEBSITE_REVALIDATE_URL = `http://127.0.0.1:${(website.address() as AddressInfo).port}/api/cms/revalidate`;
    process.env.WEBSITE_REVALIDATE_TOKEN = 'revalidate-token'; // pragma: allowlist secret
    process.env.CMS_JOBS_AUTORUN = 'false';
    process.env.CMS_WEBSITE_API_KEY = 'website-key-0123456789'; // pragma: allowlist secret
    process.env.CMS_SOCIAL_HANDOFF_API_KEY = 'handoff-key-0123456789'; // pragma: allowlist secret
    process.env.CMS_ADMIN_EMAIL = 'admin@example.com';
    process.env.CMS_ADMIN_PASSWORD = 'an-admin-password'; // pragma: allowlist secret
    const { default: config } = await import('@payload-config');
    payload = await getPayload({ config });
    const find = async (email: string) => (await payload.find({ collection: 'users', where: { email: { equals: email } } })).docs[0] as unknown as User;
    users.admin = await find('admin@example.com');
    users.website = await find('website@robots.cms.invalid');
    users.handoff = await find('social-handoff@robots.cms.invalid');
    for (const role of ['publisher', 'editor', 'agent'] as const) {
      users[role] = (await payload.create({
        collection: 'users',
        data: { email: `${role}@example.com`, password: 'a-long-enough-password', role },
      })) as unknown as User;
    }
    for (const user of Object.values(users)) user.collection = 'users';
  });

  afterAll(async () => {
    await payload?.destroy();
    website?.close();
  });

  test('provisioning made the administrator, both robots with their keys, and the LinkedIn account', async () => {
    expect([users.admin.role, users.website.role, users.handoff.role]).toEqual(['admin', 'website', 'social-handoff']);
    const accounts = await payload.find({ collection: 'social-accounts' });
    expect(accounts.docs.map((a) => a.key)).toEqual(['linkedin-company']);
    // Running it again changes nothing.
    const { provision } = await import('../../src/provision');
    const lines: string[] = [];
    await provision(payload, process.env, (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  test('an editor and an agent write drafts and cannot publish', async () => {
    for (const who of ['editor', 'agent'] as const) {
      const draft = await payload.create({ collection: 'posts', data: post(`Draft by ${who}`), ...as(who) });
      expect(draft._status).toBe('draft');
      await expect(payload.create({ collection: 'posts', data: post(`Live by ${who}`, { _status: 'published' }), ...as(who) })).rejects.toThrow(/not allowed/i);
      await expect(payload.update({ collection: 'posts', id: draft.id, data: { _status: 'published' }, ...as(who) })).rejects.toThrow(/not allowed/i);
      // Asking for a non-draft save is a draft save all the same.
      const saved = await payload.update({ collection: 'posts', id: draft.id, data: { title: `Draft by ${who}, edited` }, draft: false, ...as(who) });
      expect(saved._status).toBe('draft');
    }
  });

  test('a publisher publishes, and the website is told', async () => {
    revalidations.length = 0;
    const draft = await payload.create({ collection: 'posts', data: post('Publish me'), ...as('editor') });
    const live = await payload.update({ collection: 'posts', id: draft.id, data: { _status: 'published' }, ...as('publisher') });
    expect(live._status).toBe('published');
    expect(revalidations).toEqual(['POST /api/cms/revalidate Bearer revalidate-token']);
  });

  test("an editor's or an agent's change to a live post waits as a draft; the live post is untouched", async () => {
    const live = await payload.create({ collection: 'posts', data: post('Live post', { _status: 'published' }), ...as('publisher') });
    revalidations.length = 0;
    for (const who of ['editor', 'agent'] as const) {
      await payload.update({ collection: 'posts', id: live.id, data: { title: `Changed by ${who}` }, ...as(who) });
      // An unpublish asked for without the draft flag is only a draft save, too.
      await payload.update({ collection: 'posts', id: live.id, data: { _status: 'draft' }, ...as(who) });
      const current = await payload.findByID({ collection: 'posts', id: live.id });
      expect([current._status, current.title]).toEqual(['published', 'Live post']);
      const newest = await payload.findByID({ collection: 'posts', id: live.id, draft: true });
      expect(newest.title).toBe(`Changed by ${who}`);
    }
    expect(revalidations).toEqual([]);
    // Restoring a published version is a publisher's; an editor restores it as a draft.
    // (restoreVersion reads its `draft` flag before the beforeOperation hook, so the hook
    // cannot turn it into a draft: the update access refuses the publication instead.)
    const versions = await payload.findVersions({ collection: 'posts', where: { parent: { equals: live.id } }, sort: 'createdAt' });
    await expect(payload.restoreVersion({ collection: 'posts', id: versions.docs[0].id, ...as('editor') })).rejects.toThrow(/not allowed/i);
    await payload.restoreVersion({ collection: 'posts', id: versions.docs[0].id, draft: true, ...as('editor') });
    expect((await payload.findByID({ collection: 'posts', id: live.id }))._status).toBe('published');
    const copy = await payload.duplicate({ collection: 'posts', id: live.id, data: { slug: 'live-post-copy' }, ...as('agent') });
    expect(copy._status).toBe('draft');
    // A publisher publishes the waiting change.
    const published = await payload.update({ collection: 'posts', id: live.id, data: { title: 'Live post, reviewed', _status: 'published' }, ...as('publisher') });
    expect(published.title).toBe('Live post, reviewed');
    expect(revalidations).toHaveLength(1);
  });

  test('only a publisher deletes', async () => {
    const live = await payload.create({ collection: 'posts', data: post('Delete me', { _status: 'published' }), ...as('publisher') });
    for (const who of ['editor', 'agent'] as const) {
      await expect(payload.delete({ collection: 'posts', id: live.id, ...as(who) })).rejects.toThrow(/not allowed/i);
    }
    revalidations.length = 0;
    await payload.delete({ collection: 'posts', id: live.id, ...as('publisher') });
    expect(revalidations).toHaveLength(1);
  });

  test('the website reads what is live and due, and nothing else', async () => {
    await payload.create({ collection: 'posts', data: post('Only a draft'), ...as('editor') });
    await payload.create({ collection: 'posts', data: post('Due later', { _status: 'published', publishedAt: '2999-01-01T00:00:00.000Z' }), ...as('publisher') });
    const read = await payload.find({ collection: 'posts', limit: 0, ...as('website') });
    const titles = read.docs.map((d) => d.title);
    expect(titles).toContain('Live post, reviewed');
    expect(titles).not.toContain('Only a draft');
    expect(titles).not.toContain('Due later');
    expect(read.docs.every((d) => d._status === 'published')).toBe(true);
    // Not even the draft of a live post, asked for explicitly.
    const drafts = await payload.find({ collection: 'posts', draft: true, limit: 0, ...as('website') });
    expect(drafts.docs.map((d) => d.title)).not.toContain('Changed by agent');
    await expect(payload.create({ collection: 'posts', data: post('By the website'), ...as('website') })).rejects.toThrow(/not allowed/i);
    await expect(payload.find({ collection: 'social-posts', ...as('website') })).rejects.toThrow(/not allowed/i);
  });

  test('publishing drafts one LinkedIn post per language, once', async () => {
    const twins = await payload.create({ collection: 'posts', data: post('Zwillinge'), locale: 'de', ...as('editor') });
    await payload.update({ collection: 'posts', id: twins.id, locale: 'en', data: { title: 'Twins', description: 'Twins, described.', slug: 'twins' }, ...as('editor') });
    await payload.update({ collection: 'posts', id: twins.id, data: { _status: 'published' }, ...as('publisher') });
    await payload.jobs.run();
    const drafts = await payload.find({ collection: 'social-posts', where: { blogPost: { equals: twins.id } }, sort: 'language' });
    expect(drafts.docs.map((d) => [d.language, d.status, d.sourceRef])).toEqual([
      ['de', 'draft', `blog-post:${twins.id}:de`],
      ['en', 'draft', `blog-post:${twins.id}:en`],
    ]);
    await payload.update({ collection: 'posts', id: twins.id, data: { title: 'Zwillinge, neu', _status: 'published' }, ...as('publisher') });
    await payload.jobs.run();
    expect((await payload.count({ collection: 'social-posts', where: { blogPost: { equals: twins.id } } })).totalDocs).toBe(2);
  });

  test('a social post goes out only once a publisher approved it, and the hand-off records only what it did', async () => {
    const [account] = (await payload.find({ collection: 'social-accounts' })).docs;
    const draft = await payload.create({ collection: 'social-posts', data: { account: account.id, language: 'de', text: 'Neu im Blog.' }, ...as('agent') });
    await payload.update({ collection: 'social-posts', id: draft.id, data: { status: 'in_review' }, ...as('agent') });
    await expect(payload.update({ collection: 'social-posts', id: draft.id, data: { status: 'approved' }, ...as('editor') })).rejects.toThrow(/not allowed/i);
    await expect(payload.update({ collection: 'social-posts', id: draft.id, data: { status: 'scheduled' }, ...as('handoff') })).rejects.toThrow(/not allowed/i);
    await payload.update({ collection: 'social-posts', id: draft.id, data: { status: 'approved' }, ...as('publisher') });
    // Approved, it is out of the drafters' hands.
    await expect(payload.update({ collection: 'social-posts', id: draft.id, data: { text: 'Changed after approval.' }, ...as('agent') })).rejects.toThrow(/not allowed/i);
    const handed = await payload.update({
      collection: 'social-posts',
      id: draft.id,
      data: { status: 'scheduled', externalId: 'buffer-1', text: 'The hand-off may not write this.' },
      ...as('handoff'),
    });
    expect([handed.status, handed.externalId, handed.text]).toEqual(['scheduled', 'buffer-1', 'Neu im Blog.']);
    await expect(payload.delete({ collection: 'social-posts', id: draft.id, ...as('agent') })).rejects.toThrow(/not allowed/i);
  });

  test('nobody grants themselves a role, and a short password is refused', async () => {
    const editor = await payload.update({ collection: 'users', id: users.editor.id, data: { role: 'admin' }, ...as('editor') });
    expect(editor.role).toBe('editor');
    await expect(
      payload.create({ collection: 'users', data: { email: 'short@example.com', password: 'short', role: 'editor' }, ...as('admin') }),
    ).rejects.toThrow(/password/i);
  });
});
