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
 *
 * Read again on 2026-11-11 (reference, error-handling, pagination and the
 * `get-posts-for-channels` and `get-organizations` examples): `CreatePostInput`
 * has no idempotency key and no field for a reference of ours, and no header is
 * documented for one, so sending twice is two posts. What stands in for it is a
 * lookup: `posts(first, after, input: { organizationId, sort, filter: { channelIds } })`
 * lists a channel's posts with `id`, `text` and `createdAt`, and the text we send
 * ends in a link that names the CMS post (`utm_content`). Errors that are the
 * caller's come back as typed members of the mutation's union with a `message`;
 * the rest are in `errors` with `extensions.code` (`UNAUTHORIZED`, `FORBIDDEN`,
 * `NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, `UNEXPECTED`), normally with HTTP 200.
 * No request here has run against a Buffer account yet (ADR-0155).
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
  // `sending` is an approved post the hand-off has claimed; it is built again only to find it in Buffer.
  if (post.status !== 'approved' && post.status !== 'sending') return `status is ${post.status}, not approved`;
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

/**
 * One GraphQL request. Resolves to `{ data }`, to `{ error }` when Buffer said
 * no before doing anything, or to `{ unknown }` when the answer does not say
 * whether it acted: no answer at all, a 5xx, or its `UNEXPECTED`.
 */
async function request(query, variables, apiKey, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(BUFFER_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    return { unknown: `Buffer did not answer: ${error.message}` };
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && !body.errors) return { data: body.data };
  const said = `Buffer answered ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 500)}`;
  const unexpected = (body.errors ?? []).some((e) => e?.extensions?.code === 'UNEXPECTED');
  return res.status >= 500 || unexpected ? { unknown: said } : { error: said };
}

/**
 * Sends one input to Buffer. Resolves to `{ id }`, to `{ error }` when Buffer
 * refused it (nothing went out), or to `{ unknown }` when Buffer may or may not
 * hold the post now. Only `findInBuffer` settles an `unknown`; sending again
 * would risk a second post.
 */
export async function sendToBuffer(input, apiKey, fetchImpl = fetch) {
  const answer = await request(CREATE_POST_MUTATION, { input }, apiKey, fetchImpl);
  if (!('data' in answer)) return answer;
  const result = answer.data?.createPost;
  if (result?.post?.id) return { id: result.post.id };
  if (result?.message) return { error: result.message };
  return { unknown: 'Buffer answered without a post and without a reason' };
}

export const ORGANIZATIONS_QUERY = `query Organizations { account { organizations { id } } }`;

export const POSTS_QUERY = `query ChannelPosts($input: PostsInput!, $after: String) {
  posts(first: 50, after: $after, input: $input) {
    edges { node { id text createdAt channelId } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Pages of 50 read per organization before the lookup gives up rather than answer "not there". */
const MAX_PAGES = 20;

/** The newest post of one organization on `channelId` that `matches`, reading back to `since`. */
async function findInOrganization(organizationId, { channelId, since, matches }, apiKey, fetchImpl) {
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const input = { organizationId, sort: [{ field: 'createdAt', direction: 'desc' }], filter: { channelIds: [channelId] } };
    const answer = await request(POSTS_QUERY, { input, after }, apiKey, fetchImpl);
    if (!('data' in answer)) return { unknown: answer.unknown ?? answer.error };
    const posts = answer.data?.posts;
    if (!Array.isArray(posts?.edges)) return { unknown: 'Buffer listed no posts field' };
    const nodes = posts.edges.map((edge) => edge.node);
    const found = nodes.find((node) => node.channelId === channelId && matches(node.text ?? ''));
    if (found) return { id: found.id };
    const readPastSince = nodes.some((node) => new Date(node.createdAt) < since);
    if (readPastSince || !posts.pageInfo?.hasNextPage) return { missing: true };
    after = posts.pageInfo.endCursor;
  }
  return { unknown: `more than ${MAX_PAGES * 50} posts on the channel since ${since.toISOString()}` };
}

/**
 * Whether Buffer holds a post we may have sent: `{ id }`, `{ missing: true }`
 * when every post of the channel created since `since` was read and none
 * matches, or `{ unknown }` when Buffer could not be read. `missing` is only
 * ever answered from a complete read, because the caller treats it as "nothing
 * went out".
 * @param {{ channelId: string, since: Date, matches: (text: string) => boolean }} wanted
 */
export async function findInBuffer(wanted, apiKey, fetchImpl = fetch) {
  const answer = await request(ORGANIZATIONS_QUERY, {}, apiKey, fetchImpl);
  if (!('data' in answer)) return { unknown: answer.unknown ?? answer.error };
  const organizations = answer.data?.account?.organizations;
  if (!Array.isArray(organizations) || organizations.length === 0) return { unknown: 'Buffer listed no organization for this key' };
  for (const organization of organizations) {
    const result = await findInOrganization(organization.id, wanted, apiKey, fetchImpl);
    if (!('missing' in result)) return result;
  }
  return { missing: true };
}
