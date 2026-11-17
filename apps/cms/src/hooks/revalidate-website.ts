import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload';

const TIMEOUT_MS = 3_000;

export interface RevalidateSettings {
  url: string;
  token: string;
}

export function revalidateSettings(env: Record<string, string | undefined> = process.env): RevalidateSettings | undefined {
  const url = env.WEBSITE_REVALIDATE_URL?.trim();
  const token = env.WEBSITE_REVALIDATE_TOKEN?.trim();
  return url && token ? { url, token } : undefined;
}

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

export async function changedLive(req: PayloadRequest, doc: WithStatus, previousDoc: WithStatus): Promise<boolean> {
  if (doc?._status === 'published') return true;
  if (previousDoc?._status !== 'published' || doc?.id === undefined) return false;
  const live = await req.payload.db.findOne<{ id: number; _status?: string }>({ collection: 'posts', req, where: { id: { equals: doc.id } } });
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
