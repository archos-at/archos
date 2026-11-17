import type { CollectionAfterChangeHook, Payload, PayloadRequest, TaskConfig } from 'payload';
import { LOCALES, type Locale } from '../fields/choices';

export const DEFAULT_ACCOUNT_KEY = 'linkedin-company';

type Localized<T> = Partial<Record<Locale, T>> | null | undefined;
export interface PublishedPost {
  id: number;
  title?: Localized<string>;
  description?: Localized<string>;
}

export function socialDrafts(post: PublishedPost, accountId: number) {
  return LOCALES.flatMap((locale) => {
    const title = post.title?.[locale]?.replace(/\u00AD/g, '').trim();
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

export async function draftSocialPostsFor(payload: Payload, postId: number, req?: PayloadRequest) {
  const accounts = await payload.find({
    collection: 'social-accounts',
    where: { and: [{ key: { equals: DEFAULT_ACCOUNT_KEY } }, { active: { equals: true } }] },
    limit: 1,
    req,
  });
  const account = accounts.docs[0];
  if (!account) return { created: 0, reason: `no active ${DEFAULT_ACCOUNT_KEY} account` };
  const post = (await payload.findByID({ collection: 'posts', id: postId, locale: 'all', depth: 0, disableErrors: true, req })) as unknown as PublishedPost | null;
  if (!post) return { created: 0, reason: `post ${postId} is gone` };
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
    const { created } = await draftSocialPostsFor(req.payload, Number(input.postId), req);
    return { output: { created } };
  },
};

export const queueSocialDrafts: CollectionAfterChangeHook = async ({ context, doc, previousDoc, req }) => {
  if (context.skipSocialDrafts || doc._status !== 'published' || previousDoc?._status === 'published') return doc;
  await req.payload.jobs.queue({ task: 'draftSocialPosts', input: { postId: String(doc.id) }, req });
  return doc;
};
