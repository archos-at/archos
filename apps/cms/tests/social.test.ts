import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CREATE_POST_MUTATION, createPostInput, sendToBuffer } from '../social/buffer.mjs';
import { blogPostPath, shareImageUrl, trackedLink } from '../social/links.mjs';
import { summaryPost } from '../social/release-summaries.mjs';

const SITE = 'https://example.com';
const CMS = 'https://cms.example.com';
const NOW = new Date('2026-11-05T10:00:00Z');

/** A `social-posts` document as the hand-off reads it (`locale=all&depth=2`). */
const account = { id: 1, key: 'linkedin-company', network: 'linkedin', maxLength: 3000, publisherChannelId: 'chan-1', active: true };
const blogPost = { id: 7, coverType: 'drawing', cover: 'welcome', publishedAt: '2026-11-01T00:00:00Z', slug: { de: 'willkommen', en: 'welcome' } };
type Built = { input: { text: string; channelId: string; mode: string; dueAt?: string; assets?: unknown[] }; error: string };
/** createPostInput, typed for the assertions (buffer.mjs is plain JavaScript). */
const build = (post: object, ctx: { siteUrl: string; cmsPublicUrl: string; now: Date }) => createPostInput(post, ctx) as unknown as Built;
const approved = (extra: Record<string, unknown> = {}) => ({ id: 12345678901, status: 'approved', language: 'de', text: 'Neu im Blog.', linkUrl: null, utmCampaign: null, image: null, scheduledAt: null, account, blogPost, ...extra });

test('a tracked link carries the four UTM parameters and drops old ones', () => {
  const link = new URL(trackedLink('https://example.com/blog/x/?utm_source=old&ref=1', { network: 'linkedin', campaign: 'x', accountId: 'linkedin-company', postId: '1a2b3c4d-9999' }));
  assert.equal(link.searchParams.get('utm_source'), 'linkedin');
  assert.equal(link.searchParams.get('utm_medium'), 'social');
  assert.equal(link.searchParams.get('utm_campaign'), 'x');
  assert.equal(link.searchParams.get('utm_content'), 'linkedin-company-1a2b3c4d');
  assert.equal(link.searchParams.get('ref'), '1');
  assert.equal(blogPostPath('en', 'welcome'), '/en/blog/welcome/');
  assert.equal(shareImageUrl(SITE, 'welcome'), 'https://example.com/media/covers/welcome.png');
});

test('an approved post becomes a queued Buffer post with its tracked link and share image', () => {
  const { input } = build(approved(), { siteUrl: SITE, cmsPublicUrl: CMS, now: NOW });
  assert.equal(input.channelId, 'chan-1');
  assert.equal(input.mode, 'addToQueue');
  assert.match(input.text, /^Neu im Blog\.\n\nhttps:\/\/example\.com\/blog\/willkommen\/\?utm_source=linkedin&utm_medium=social&utm_campaign=willkommen&utm_content=linkedin-company-12345678$/);
  assert.deepEqual(input.assets, [{ image: { url: 'https://example.com/media/covers/welcome.png' } }]);
});

test('a scheduled post goes at its time, and its own image wins over the share image', () => {
  const image = { url: '/api/media/file/f1.png', sizes: { share: { url: '/api/media/file/f1-1200x630.jpg' } } };
  const { input } = build(approved({ scheduledAt: '2026-11-06T08:00:00Z', image }), { siteUrl: SITE, cmsPublicUrl: CMS, now: NOW });
  assert.equal(input.mode, 'customScheduled');
  assert.equal(input.dueAt, '2026-11-06T08:00:00.000Z');
  assert.deepEqual(input.assets, [{ image: { url: 'https://cms.example.com/api/media/file/f1-1200x630.jpg' } }]);
  // An image cover's share size stands in when the post has no image of its own.
  const covered = { ...blogPost, coverType: 'image', cover: null, coverImage: { sizes: { share: { url: '/api/media/file/c-1200x630.jpg' } } } };
  const { input: second } = build(approved({ blogPost: covered }), { siteUrl: SITE, cmsPublicUrl: CMS, now: NOW });
  assert.deepEqual(second.assets, [{ image: { url: 'https://cms.example.com/api/media/file/c-1200x630.jpg' } }]);
});

test('nothing is handed over that a person has not approved, or that would break', () => {
  const ctx = { siteUrl: SITE, cmsPublicUrl: CMS, now: NOW };
  assert.match(build(approved({ status: 'in_review' }), ctx).error, /not approved/);
  assert.match(build(approved({ account: { ...account, publisherChannelId: null } }), ctx).error, /by hand/);
  assert.match(build(approved({ scheduledAt: '2026-10-01T00:00:00Z' }), ctx).error, /before the blog post/);
  assert.match(build(approved({ language: 'fr' }), ctx).error, /no fr version/);
  // An id that did not populate: the hand-off may read only live posts.
  assert.match(build(approved({ blogPost: 7 }), ctx).error, /not live/);
  assert.match(build(approved({ text: 'x'.repeat(2950) }), ctx).error, /over the account's 3000/);
});

test('Buffer answers are read as an id or an error', async () => {
  const reply = (status: number, body: unknown) => async (url: string, init: { headers: Record<string, string>; body: string }) => {
    assert.equal(url, 'https://api.buffer.com');
    assert.equal(init.headers.Authorization, 'Bearer key');
    assert.equal(JSON.parse(init.body).query, CREATE_POST_MUTATION);
    return { ok: status < 400, status, json: async () => body };
  };
  assert.deepEqual(await sendToBuffer({}, 'key', reply(200, { data: { createPost: { post: { id: 'p9' } } } })), { id: 'p9' });
  assert.deepEqual(await sendToBuffer({}, 'key', reply(200, { data: { createPost: { message: 'Channel paused' } } })), { error: 'Channel paused' });
  assert.match((await sendToBuffer({}, 'key', reply(401, { errors: [{ message: 'bad key' }] }))).error, /401/);
});

test('a week summary becomes a draft that links the changelog with its own campaign', () => {
  const post = summaryPost('2026-W44', 'Ctrl+K now searches everything.', 'en', SITE);
  assert.deepEqual(post, {
    status: 'draft',
    account: 'linkedin-company',
    language: 'en',
    text: 'Ctrl+K now searches everything.',
    linkUrl: 'https://example.com/en/changelog/',
    utmCampaign: 'changelog-2026-w44',
    sourceRef: 'release-summary:2026-W44:en',
  });
});

test("the CMS client speaks Payload's REST query string and its API-key header", async () => {
  const { cms, query } = await import('../social/cms-client.mjs');
  assert.equal(query({ where: { status: { equals: 'approved' } }, depth: 2 }), '?where%5Bstatus%5D%5Bequals%5D=approved&depth=2');
  const seen: string[] = [];
  const client = cms('http://cms:3100/', 'key', async (url: string, init: { headers: Record<string, string> }) => {
    seen.push(`${url} ${init.headers.Authorization}`);
    return new Response(JSON.stringify({ docs: [{ id: 1 }] }));
  });
  assert.deepEqual(await client.find('social-posts'), [{ id: 1 }]);
  assert.deepEqual(seen, ['http://cms:3100/api/social-posts?limit=0 users API-Key key']);
});
