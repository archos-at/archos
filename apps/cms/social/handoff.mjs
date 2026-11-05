#!/usr/bin/env node
/**
 * Hands every approved social post to Buffer, which publishes it at its time
 * (ADR-0155). A person approves in the CMS; nothing here approves, and nothing
 * here can: the hand-off token holds only the `Social hand-off` policy, which
 * reads approved posts and moves them on to scheduled or failed
 * (apps/cms/src/access/social.ts).
 *
 *   CMS_URL=… CMS_SOCIAL_HANDOFF_API_KEY=… SITE_URL=https://… CMS_PUBLIC_URL=https://… \
 *     node social/handoff.mjs              # dry run: the exact input each post would be sent as
 *   … BUFFER_API_KEY=… node social/handoff.mjs --apply
 *
 * A post Buffer refuses is set to `failed` with Buffer's message in
 * `publishError`; an editor fixes it and sends it to review again.
 */
import { createPostInput, sendToBuffer } from './buffer.mjs';
import { cmsFromEnv } from './cms-client.mjs';

function required(env, name) {
  if (!env[name]) throw new Error(`Set ${name}.`);
  return env[name];
}

export async function handoff({ apply, env = process.env, now = new Date(), log = console.log }) {
  const cms = cmsFromEnv('CMS_SOCIAL_HANDOFF_API_KEY', env);
  const context = { siteUrl: required(env, 'SITE_URL'), cmsPublicUrl: required(env, 'CMS_PUBLIC_URL'), now };
  const apiKey = apply ? required(env, 'BUFFER_API_KEY') : undefined;
  const posts = await cms.find('social-posts', { where: { status: { equals: 'approved' } }, depth: 2, locale: 'all', sort: 'scheduledAt' });
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
      await cms.update('social-posts', post.id, { status: 'failed', publishError: sent.error });
      log(`  failed   ${post.id}: ${sent.error}`);
    } else {
      await cms.update('social-posts', post.id, { status: 'scheduled', externalId: sent.id, publishError: null });
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
