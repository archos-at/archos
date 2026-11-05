/**
 * An approved social post as Buffer's `createPost` input (ADR-0155). Pure: the
 * hand-off (`handoff.mjs`) reads the CMS, calls this, and sends the result.
 *
 * A post is a `social-posts` document read with `locale=all&depth=2`: its
 * `account`, its `blogPost` (when the hand-off may read it, which is only when it
 * is live) and its images populated, the blog post's slug an object by locale.
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

/** The blog post's slug in the post's language, or undefined. */
function slugFor(post) {
  const slug = post.blogPost?.slug;
  return typeof slug === 'object' && slug !== null ? slug[post.language] : undefined;
}

/**
 * Why `post` cannot be handed over yet, or undefined when it can.
 * @param {object} post
 * @param {Date} now
 */
export function refusal(post, now) {
  if (post.status !== 'approved') return `status is ${post.status}, not approved`;
  if (!post.account?.active) return 'its account is not active';
  if (!post.account.publisherChannelId) return 'its account has no publisher channel id (publish it by hand)';
  if (!post.blogPost && !post.linkUrl) return 'it links nothing: set a blog post or a link';
  // The hand-off reads only live posts: an id that did not populate is a post that is not live.
  if (post.blogPost && typeof post.blogPost !== 'object') return 'the blog post it links is not live';
  if (post.blogPost && !slugFor(post)) return `the blog post has no ${post.language} version`;
  const due = post.scheduledAt ? new Date(post.scheduledAt) : now;
  if (post.blogPost && new Date(post.blogPost.publishedAt) > due) return 'it would go out before the blog post it links is live';
  return undefined;
}

/** The link the post carries, tracked. */
export function linkFor(post, siteUrl) {
  const slug = slugFor(post);
  const url = post.linkUrl ?? new URL(blogPostPath(post.language, slug), siteUrl).href;
  return trackedLink(url, {
    network: post.account.network,
    campaign: post.utmCampaign ?? slug ?? 'social',
    accountId: post.account.key,
    postId: post.id,
  });
}

/** A file's URL on the CMS's public host, whether Payload answered with a path or with its own server URL. */
function onPublicHost(url, cmsPublicUrl) {
  const { pathname, search } = new URL(url, 'http://cms');
  return new URL(`${pathname}${search}`, cmsPublicUrl).href;
}

/** The image the post shows: its own upload, else the blog post's share image, else none. */
export function imageFor(post, { siteUrl, cmsPublicUrl }) {
  const own = post.image?.sizes?.share?.url ?? post.image?.url;
  if (own) return onPublicHost(own, cmsPublicUrl);
  const blog = post.blogPost;
  if (blog?.coverType === 'image' && blog.coverImage?.sizes?.share?.url) return onPublicHost(blog.coverImage.sizes.share.url, cmsPublicUrl);
  if (blog?.cover) return shareImageUrl(siteUrl, blog.cover);
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
  if (text.length > post.account.maxLength) {
    return { error: `${text.length} characters with the link, over the account's ${post.account.maxLength}` };
  }
  const image = imageFor(post, { siteUrl, cmsPublicUrl });
  const input = {
    text,
    channelId: post.account.publisherChannelId,
    schedulingType: 'automatic',
    ...(post.scheduledAt ? { mode: 'customScheduled', dueAt: new Date(post.scheduledAt).toISOString() } : { mode: 'addToQueue' }),
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
