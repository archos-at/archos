/**
 * When a blog post is published, a LinkedIn draft for each of its languages
 * (ADR-0155). A draft only: a person edits it, a publisher approves it, and only
 * then does the hand-off give it to Buffer (social/handoff.mjs).
 *
 * Queued by the posts' afterChange hook and run by the jobs queue, so a publish
 * never waits on it and a failure is retried. Keyed by `sourceRef`
 * (`blog-post:<id>:<locale>`): publishing a post again after an edit drafts
 * nothing new, and a draft someone has worked on is never overwritten.
 */
import type { CollectionAfterChangeHook, Payload, PayloadRequest, TaskConfig } from 'payload';
import { LOCALES, type Locale } from '../fields/choices';

/** The account a new post's drafts are for (provisioned by scripts/provision.ts). */
export const DEFAULT_ACCOUNT_KEY = 'linkedin-company';

type Localized<T> = Partial<Record<Locale, T>> | null | undefined;
export interface PublishedPost {
  id: number | string;
  title?: Localized<string>;
  description?: Localized<string>;
}

/** The drafts a published post asks for, one per language it is written in. Pure. */
export function socialDrafts(post: PublishedPost, accountId: number | string) {
  return LOCALES.flatMap((locale) => {
    const title = post.title?.[locale]?.replace(/­/g, '').trim();
    if (!title) return [];
    const description = post.description?.[locale]?.trim();
    return [
      {
        status: 'draft' as const,
        account: accountId,
        language: locale,
        blogPost: post.id,
        text: description ? `${title}\n\n${description}` : title,
        sourceRef: `blog-post:${post.id}:${locale}`,
      },
    ];
  });
}

export async function draftSocialPostsFor(payload: Payload, postId: number | string, req?: PayloadRequest) {
  const accounts = await payload.find({
    collection: 'social-accounts',
    where: { and: [{ key: { equals: DEFAULT_ACCOUNT_KEY } }, { active: { equals: true } }] },
    limit: 1,
    req,
  });
  const account = accounts.docs[0];
  if (!account) return { created: 0, reason: `no active ${DEFAULT_ACCOUNT_KEY} account` };
  const post = (await payload.findByID({ collection: 'posts', id: postId, locale: 'all', depth: 0, req })) as unknown as PublishedPost;
  let created = 0;
  for (const draft of socialDrafts(post, account.id)) {
    const existing = await payload.count({ collection: 'social-posts', where: { sourceRef: { equals: draft.sourceRef } }, req });
    if (existing.totalDocs > 0) continue;
    await payload.create({ collection: 'social-posts', data: draft, req });
    created += 1;
  }
  return { created };
}

export const draftSocialPostsTask: TaskConfig<{ input: { postId: string }; output: { created: number } }> = {
  slug: 'draftSocialPosts',
  retries: 3,
  inputSchema: [{ name: 'postId', type: 'text', required: true }],
  outputSchema: [{ name: 'created', type: 'number', required: true }],
  handler: async ({ input, req }) => {
    const { created } = await draftSocialPostsFor(req.payload, input.postId, req);
    return { output: { created } };
  },
};

/** Queues the drafts when a post is published; a draft save queues nothing. */
export const queueSocialDrafts: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (doc._status !== 'published' || previousDoc?._status === 'published') return doc;
  await req.payload.jobs.queue({ task: 'draftSocialPosts', input: { postId: String(doc.id) }, req });
  return doc;
};
