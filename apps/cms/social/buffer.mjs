/**
 * An approved social post as Buffer's `createPost` input (ADR-0155). Pure: the
 * hand-off (`handoff.mjs`) reads the CMS, calls this, and sends the result.
 *
 * Buffer's GraphQL API, read on 2026-11-05 at developers.buffer.com:
 * `POST https://api.buffer.com`, `Authorization: Bearer <API key>`; `createPost`
 * takes `text`, `channelId`, `schedulingType: automatic`, `mode` (`addToQueue`,
 * `customScheduled` with `dueAt`), and `assets: [{ image: { url } }]`, where the
 * URL must be public. It answers `PostActionSuccess { post { id } }` or
 * `MutationError { message }`.
 */
import { blogPostPath, shareImageUrl, trackedLink } from './links.mjs';

export const BUFFER_ENDPOINT = 'https://api.buffer.com';

export const CREATE_POST_MUTATION = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

/**
 * Why `post` cannot be handed over yet, or undefined when it can.
 * @param {object} post     a `social_posts` row with `account`, `blog_post` (and its translations) expanded
 * @param {Date} now
 */
export function refusal(post, now) {
  if (post.status !== 'approved') return `status is ${post.status}, not approved`;
  if (!post.account?.active) return 'its account is not active';
  if (!post.account.publisher_channel_id) return 'its account has no publisher channel id (publish it by hand)';
  if (!post.blog_post && !post.link_url) return 'it links nothing: set a blog post or a link';
  if (post.blog_post && !translationFor(post)) return `the blog post has no live ${post.language} translation`;
  const due = post.scheduled_at ? new Date(post.scheduled_at) : now;
  if (post.blog_post && new Date(post.blog_post.publish_date) > due) {
    return 'it would go out before the blog post it links is live';
  }
  return undefined;
}

function translationFor(post) {
  return post.blog_post?.translations?.find((t) => t.languages_code === post.language);
}

/** The link the post carries, tracked. */
export function linkFor(post, siteUrl) {
  const translation = translationFor(post);
  const url = post.link_url ?? new URL(blogPostPath(post.language, translation.slug), siteUrl).href;
  return trackedLink(url, {
    network: post.account.network,
    campaign: post.utm_campaign ?? translation?.slug ?? 'social',
    accountId: post.account.id,
    postId: post.id,
  });
}

/** The image the post shows: its own upload, else the blog post's share image, else none. */
export function imageFor(post, { siteUrl, cmsPublicUrl }) {
  if (post.image) return new URL(`/assets/${post.image}`, cmsPublicUrl).href;
  if (post.blog_post?.cover) return shareImageUrl(siteUrl, post.blog_post.cover);
  return undefined;
}

/**
 * The `createPost` input, or an error naming why not.
 * @returns {{ input: object } | { error: string }}
 */
export function createPostInput(post, { siteUrl, cmsPublicUrl, now = new Date() }) {
  const refused = refusal(post, now);
  if (refused) return { error: refused };
  const text = `${post.text.trim()}\n\n${linkFor(post, siteUrl)}`;
  if (text.length > post.account.max_length) {
    return { error: `${text.length} characters with the link, over the account's ${post.account.max_length}` };
  }
  const image = imageFor(post, { siteUrl, cmsPublicUrl });
  const input = {
    text,
    channelId: post.account.publisher_channel_id,
    schedulingType: 'automatic',
    ...(post.scheduled_at ? { mode: 'customScheduled', dueAt: new Date(post.scheduled_at).toISOString() } : { mode: 'addToQueue' }),
    ...(image ? { assets: [{ image: { url: image } }] } : {}),
  };
  return { input };
}

/** Sends one input to Buffer; resolves to `{ id }` or `{ error }`. */
export async function sendToBuffer(input, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(BUFFER_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CREATE_POST_MUTATION, variables: { input } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) return { error: `Buffer answered ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 500)}` };
  const result = body.data?.createPost;
  if (result?.post?.id) return { id: result.post.id };
  return { error: result?.message ?? 'Buffer returned no post' };
}
