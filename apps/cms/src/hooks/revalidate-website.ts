/**
 * Tells the website that what is live changed, so its posts copy turns stale
 * and the next request reads the CMS (apps/website/src/pages/api/cms/revalidate.ts).
 * Each web pod keeps its own copy: the pod this request reaches shows the change
 * at once, the others within their 60 s.
 *
 * Only a change to what is live calls it: a publish, an unpublish, a delete. A
 * draft save (autosave, every few seconds while someone types) changes nothing
 * the website reads. A failed call is logged and never fails the save: the
 * website's copy expires on its own.
 */
import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload';

const TIMEOUT_MS = 3_000;

export interface RevalidateSettings {
  url: string;
  token: string;
}

/** `WEBSITE_REVALIDATE_URL` and `WEBSITE_REVALIDATE_TOKEN`, or undefined: then nothing is called. */
export function revalidateSettings(env: Record<string, string | undefined> = process.env): RevalidateSettings | undefined {
  const url = env.WEBSITE_REVALIDATE_URL?.trim();
  const token = env.WEBSITE_REVALIDATE_TOKEN?.trim();
  return url && token ? { url, token } : undefined;
}

/** POSTs to the website; true when it answered 2xx. */
export async function notifyWebsite(settings: RevalidateSettings, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl(settings.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok;
}

async function notify(req: PayloadRequest, reason: string): Promise<void> {
  const settings = revalidateSettings();
  if (!settings) return;
  try {
    const ok = await notifyWebsite(settings);
    req.payload.logger.info({ msg: 'website revalidate', reason, ok });
  } catch (error) {
    req.payload.logger.warn({ msg: 'website revalidate failed; its copy expires on its own', reason, err: String(error) });
  }
}

type WithStatus = { id?: number | string; _status?: string | null } | null | undefined;

/**
 * Whether a save changed what is live. `doc` is what was saved; after a draft
 * save over a published post it is the draft, and the live document is still the
 * published one, so the live document is asked when the status alone cannot tell.
 */
export async function changedLive(req: PayloadRequest, doc: WithStatus, previousDoc: WithStatus): Promise<boolean> {
  if (doc?._status === 'published') return true;
  if (previousDoc?._status !== 'published' || doc?.id === undefined) return false;
  const live = await req.payload.db.findOne<{ _status?: string }>({ collection: 'posts', req, where: { id: { equals: doc.id } } });
  return live?._status !== 'published';
}

export const revalidateAfterChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (await changedLive(req, doc, previousDoc)) await notify(req, `post ${doc.id} ${doc._status}`);
  return doc;
};

export const revalidateAfterDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
  if ((doc as WithStatus)?._status === 'published') await notify(req, `post ${doc.id} deleted`);
  return doc;
};
