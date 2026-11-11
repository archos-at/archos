#!/usr/bin/env node
/**
 * Hands every approved social post to Buffer, which publishes it at its time
 * (ADR-0155). A person approves in the CMS; nothing here approves, and nothing
 * here can: the hand-off token holds only the `Social hand-off` policy, which
 * claims an approved post and records what Buffer answered
 * (apps/cms/src/access/social.ts).
 *
 *   CMS_URL=… CMS_SOCIAL_HANDOFF_API_KEY=… SITE_URL=https://… CMS_PUBLIC_URL=https://… \
 *     node social/handoff.mjs              # dry run: the exact input each post would be sent as
 *   … BUFFER_API_KEY=… node social/handoff.mjs --apply
 *
 * Buffer has no idempotency key (buffer.mjs), so a post is sent once by order
 * of writes: the post is set to `sending` first, then sent, then recorded as
 * `scheduled` with Buffer's id. Whatever fails after the claim leaves the post
 * `sending`, and no run ever sends a `sending` post: the next run looks for it
 * in Buffer and records what it finds. The CMS refuses the claim to all but one
 * of two runs that overlap.
 *
 * A post Buffer refuses is set to `failed` with Buffer's message in
 * `publishError`; an editor fixes it and sends it to review again.
 */
import { createPostInput, findInBuffer, linkFor, sendToBuffer } from './buffer.mjs';
import { cmsFromEnv } from './cms-client.mjs';

/** A claim younger than this may be a run that is sending right now, so it is not reconciled yet. */
export const CLAIM_GRACE_MS = 10 * 60 * 1000;
/** How far before the claim a Buffer post may be dated and still be ours: the two clocks differ. */
const CLOCK_SLACK_MS = 5 * 60 * 1000;

const NOT_IN_BUFFER =
  'The hand-off was interrupted after it claimed this post, and Buffer holds no post with its link: nothing went out. Check the channel in Buffer, then send it to review again.';

function required(env, name) {
  if (!env[name]) throw new Error(`Set ${name}.`);
  return env[name];
}

/**
 * Writes what happened to a post. A write that fails must not stop the run or
 * be mistaken for "not sent": the post stays `sending` and the next run
 * reconciles it.
 */
async function record(cms, post, data, log) {
  try {
    await cms.update('social-posts', post.id, data);
    return true;
  } catch (error) {
    log(`  unrecorded ${post.id}: ${JSON.stringify(data)} was not written (${error.message}); it stays sending and the next run reconciles it`);
    return false;
  }
}

/** A post left `sending` by an earlier run: record what Buffer holds, and never send. */
async function reconcile(post, { cms, context, apiKey, log }) {
  const claimedAt = new Date(post.updatedAt);
  if (context.now - claimedAt < CLAIM_GRACE_MS) {
    log(`  in flight ${post.id}: claimed at ${post.updatedAt}, left to the run that claimed it`);
    return;
  }
  // The link is what names the post in Buffer; a post it cannot be rebuilt for cannot be looked up, and is not guessed at.
  const built = createPostInput(post, context);
  if ('error' in built) {
    log(`  stuck    ${post.id}: ${built.error}, so Buffer cannot be asked about it; look in Buffer and set it failed or archived by hand`);
    return;
  }
  const link = linkFor(post, context.siteUrl);
  const found = await findInBuffer(
    { channelId: post.account.publisherChannelId, since: new Date(claimedAt.getTime() - CLOCK_SLACK_MS), matches: (text) => text.includes(link) },
    apiKey,
  );
  if ('id' in found) {
    if (await record(cms, post, { status: 'scheduled', externalId: found.id, publishError: null }, log)) log(`  reconciled ${post.id}: Buffer holds it as post ${found.id}`);
  } else if ('missing' in found) {
    if (await record(cms, post, { status: 'failed', publishError: NOT_IN_BUFFER }, log)) log(`  failed   ${post.id}: claimed but not in Buffer`);
  } else {
    log(`  unknown  ${post.id}: ${found.unknown}; it stays sending`);
  }
}

/** An approved post: claim it, send it, record the answer. */
async function send(post, input, { cms, apiKey, log }) {
  try {
    await cms.update('social-posts', post.id, { status: 'sending', externalId: null, publishError: null });
  } catch (error) {
    log(`  skipped  ${post.id}: not claimed, so not sent (${error.message})`);
    return;
  }
  const sent = await sendToBuffer(input, apiKey);
  if ('id' in sent) {
    if (await record(cms, post, { status: 'scheduled', externalId: sent.id, publishError: null }, log)) log(`  scheduled ${post.id} as Buffer post ${sent.id}`);
  } else if ('error' in sent) {
    if (await record(cms, post, { status: 'failed', publishError: sent.error }, log)) log(`  failed   ${post.id}: ${sent.error}`);
  } else {
    log(`  unknown  ${post.id}: ${sent.unknown}; it stays sending and the next run asks Buffer`);
  }
}

export async function handoff({ apply, env = process.env, now = new Date(), log = console.log }) {
  const cms = cmsFromEnv('CMS_SOCIAL_HANDOFF_API_KEY', env);
  const context = { siteUrl: required(env, 'SITE_URL'), cmsPublicUrl: required(env, 'CMS_PUBLIC_URL'), now };
  const apiKey = apply ? required(env, 'BUFFER_API_KEY') : undefined;
  const find = (status) => cms.find('social-posts', { where: { status: { equals: status } }, depth: 2, locale: 'all', sort: 'scheduledAt' });

  const claimed = await find('sending');
  log(`${claimed.length} social posts claimed by an earlier run`);
  for (const post of claimed) {
    if (apply) await reconcile(post, { cms, context, apiKey, log });
    else log(`  would reconcile ${post.id}: look for it in Buffer, never send it`);
  }

  const posts = await find('approved');
  log(`${posts.length} approved social posts`);
  for (const post of posts) {
    const built = createPostInput(post, context);
    if ('error' in built) log(`  held     ${post.id}: ${built.error}`);
    else if (!apply) log(`  would send ${post.id}: ${JSON.stringify(built.input)}`);
    else await send(post, built.input, { cms, apiKey, log });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  handoff({ apply: process.argv.includes('--apply') }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
