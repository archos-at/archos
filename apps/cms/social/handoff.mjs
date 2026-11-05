#!/usr/bin/env node
/**
 * Hands every approved social post to Buffer, which publishes it at its time
 * (ADR-0155). A person approves in the CMS; nothing here approves, and nothing
 * here can: the hand-off token holds only the `Social hand-off` policy, which
 * reads approved posts and moves them on to scheduled or failed.
 *
 *   DIRECTUS_URL=… CMS_SOCIAL_HANDOFF_TOKEN=… SITE_URL=https://… CMS_PUBLIC_URL=https://… \
 *     node social/handoff.mjs              # dry run: the exact input each post would be sent as
 *   … BUFFER_API_KEY=… node social/handoff.mjs --apply
 *
 * A post Buffer refuses is set to `failed` with Buffer's message in
 * `publish_error`; an editor fixes it and sends it to review again.
 */
import { directusFromEnv, query } from '../scripts/lib/directus.mjs';
import { createPostInput, sendToBuffer } from './buffer.mjs';

const FIELDS = [
  'id', 'status', 'language', 'text', 'link_url', 'utm_campaign', 'image', 'scheduled_at',
  'account.id', 'account.network', 'account.max_length', 'account.publisher_channel_id', 'account.active',
  'blog_post.id', 'blog_post.cover', 'blog_post.publish_date', 'blog_post.translations.languages_code', 'blog_post.translations.slug',
].join(',');

function required(env, name) {
  if (!env[name]) throw new Error(`Set ${name}.`);
  return env[name];
}

export async function handoff({ apply, env = process.env, now = new Date(), log = console.log }) {
  const cms = directusFromEnv('CMS_SOCIAL_HANDOFF_TOKEN', env);
  const context = { siteUrl: required(env, 'SITE_URL'), cmsPublicUrl: required(env, 'CMS_PUBLIC_URL'), now };
  const apiKey = apply ? required(env, 'BUFFER_API_KEY') : undefined;
  const posts = await cms.get(`/items/social_posts${query({ filter: { status: { _eq: 'approved' } }, fields: FIELDS, limit: -1, sort: 'scheduled_at' })}`);
  log(`${posts.length} approved social posts`);
  for (const post of posts) {
    const built = createPostInput(post, context);
    if ('error' in built) {
      log(`  held     ${post.id}: ${built.error}`);
      continue;
    }
    if (!apply) {
      log(`  would send ${post.id}: ${JSON.stringify(built.input)}`);
      continue;
    }
    const sent = await sendToBuffer(built.input, apiKey);
    if ('error' in sent) {
      await cms.patch(`/items/social_posts/${post.id}`, { status: 'failed', publish_error: sent.error });
      log(`  failed   ${post.id}: ${sent.error}`);
    } else {
      await cms.patch(`/items/social_posts/${post.id}`, { status: 'scheduled', external_id: sent.id, publish_error: null });
      log(`  scheduled ${post.id} as Buffer post ${sent.id}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  handoff({ apply: process.argv.includes('--apply') }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
