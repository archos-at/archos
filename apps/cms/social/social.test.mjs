import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CREATE_POST_MUTATION, createPostInput, sendToBuffer } from './buffer.mjs';
import { blogPostPath, shareImageUrl, trackedLink } from './links.mjs';
import { summaryPost } from './release-summaries.mjs';

const SITE = 'https://example.com';
const CMS = 'https://cms.example.com';
const NOW = new Date('2026-11-05T10:00:00Z');

const account = { id: 'linkedin-company', network: 'linkedin', max_length: 3000, publisher_channel_id: 'chan-1', active: true };
const blogPost = { id: 'b1', cover: 'welcome', publish_date: '2026-11-01T00:00:00Z', translations: [{ languages_code: 'de', slug: 'willkommen' }, { languages_code: 'en', slug: 'welcome' }] };
const approved = (extra = {}) => ({ id: '1a2b3c4d-0000', status: 'approved', language: 'de', text: 'Neu im Blog.', link_url: null, utm_campaign: null, image: null, scheduled_at: null, account, blog_post: blogPost, ...extra });

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
  const { input } = createPostInput(approved(), { siteUrl: SITE, cmsPublicUrl: CMS, now: NOW });
  assert.equal(input.channelId, 'chan-1');
  assert.equal(input.mode, 'addToQueue');
  assert.match(input.text, /^Neu im Blog\.\n\nhttps:\/\/example\.com\/blog\/willkommen\/\?utm_source=linkedin&utm_medium=social&utm_campaign=willkommen&utm_content=linkedin-company-1a2b3c4d$/);
  assert.deepEqual(input.assets, [{ image: { url: 'https://example.com/media/covers/welcome.png' } }]);
});

test('a scheduled post goes at its time, and its own image wins over the share image', () => {
  const { input } = createPostInput(approved({ scheduled_at: '2026-11-06T08:00:00Z', image: 'f1' }), { siteUrl: SITE, cmsPublicUrl: CMS, now: NOW });
  assert.equal(input.mode, 'customScheduled');
  assert.equal(input.dueAt, '2026-11-06T08:00:00.000Z');
  assert.deepEqual(input.assets, [{ image: { url: 'https://cms.example.com/assets/f1' } }]);
});

test('nothing is handed over that a person has not approved, or that would break', () => {
  const ctx = { siteUrl: SITE, cmsPublicUrl: CMS, now: NOW };
  assert.match(createPostInput(approved({ status: 'in_review' }), ctx).error, /not approved/);
  assert.match(createPostInput(approved({ account: { ...account, publisher_channel_id: null } }), ctx).error, /by hand/);
  assert.match(createPostInput(approved({ scheduled_at: '2026-10-01T00:00:00Z' }), ctx).error, /before the blog post/);
  assert.match(createPostInput(approved({ language: 'fr' }), ctx).error, /no live fr translation/);
  assert.match(createPostInput(approved({ text: 'x'.repeat(2950) }), ctx).error, /over the account's 3000/);
});

test('Buffer answers are read as an id or an error', async () => {
  const reply = (status, body) => async (url, init) => {
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
    link_url: 'https://example.com/en/changelog/',
    utm_campaign: 'changelog-2026-w44',
    source_ref: 'release-summary:2026-W44:en',
  });
});
