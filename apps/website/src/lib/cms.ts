/**
 * The blog's posts from the CMS (Payload, apps/cms, ADR-0155), read server-side
 * with the website's API key (role `website`: what is live, nothing else) and
 * kept in memory, stale-while-revalidate:
 *
 * - fresh for `FRESH_MS`: served from memory;
 * - older: served from memory while one request refreshes it in the background;
 * - CMS unreachable: the last good copy keeps being served, and the failure is logged;
 * - `invalidateCmsPosts()` (the CMS calls /api/cms/revalidate when what is live
 *   changes) marks the copy stale, so the next request refreshes it.
 *
 * Each web pod holds its own copy: a publish shows at once on the pod the CMS
 * reached and within `FRESH_MS` on the others.
 *
 * The query asks for what is live (published, publish date passed) even though
 * the key can read nothing else, so a key with wider rights can never leak a
 * draft onto the site. `locale=all` brings both languages of a post in one
 * document; `depth=1` brings the author, the cover image and the images in a
 * body's blocks.
 */
import type { CmsPost, MediaFile } from './post-model';

export const FRESH_MS = 60_000;
const TIMEOUT_MS = 5_000;

export interface CmsSettings {
  /** Where the website reaches the CMS (inside the cluster: http://cms.cms.svc.cluster.local:3000). */
  url: string;
  /** The `website` user's API key. */
  apiKey: string;
  /** Where a visitor's browser reaches its images: https://cms.<domain>. */
  publicUrl: string;
}

/** The CMS this server reads, or undefined: then the site serves the MDX fixtures in src/content/blog. */
export function cmsSettings(env: Record<string, string | undefined> = process.env): CmsSettings | undefined {
  const url = env.CMS_URL?.trim();
  const apiKey = env.CMS_API_KEY?.trim();
  if (!url || !apiKey) return undefined;
  return { url, apiKey, publicUrl: env.CMS_PUBLIC_URL?.trim() || url };
}

/** The request header Payload reads an API key from (`<collection> API-Key <key>`). */
export const authorization = (settings: Pick<CmsSettings, 'apiKey'>) => `users API-Key ${settings.apiKey}`;

/** The request for every live post, newest first. */
export function postsUrl(settings: CmsSettings, now: Date = new Date()): string {
  const params = new URLSearchParams({
    'where[and][0][_status][equals]': 'published',
    'where[and][1][publishedAt][less_than_equal]': now.toISOString(),
    locale: 'all',
    depth: '1',
    limit: '0',
    sort: '-publishedAt',
  });
  return `${settings.url.replace(/\/+$/, '')}/api/posts?${params}`;
}

export async function fetchCmsPosts(settings: CmsSettings, fetchImpl: typeof fetch = fetch): Promise<CmsPost[]> {
  const res = await fetchImpl(postsUrl(settings), {
    headers: { Authorization: authorization(settings) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The CMS answered ${res.status} for the blog posts`);
  const body = (await res.json()) as { docs?: CmsPost[] };
  if (!Array.isArray(body.docs)) throw new Error('The CMS answered without a list of posts');
  return body.docs;
}

/** A stale-while-revalidate holder around one loader; exported for its tests. */
export function swrCache<T>(load: () => Promise<T>, freshMs: number, now: () => number = Date.now) {
  let value: { data: T; at: number } | undefined;
  let pending: Promise<T> | undefined;
  const refresh = () => {
    pending ??= load()
      .then((data) => {
        value = { data, at: now() };
        return data;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    async get(): Promise<T> {
      if (!value) return refresh();
      if (now() - value.at >= freshMs) {
        refresh().catch((error: unknown) => console.error(`cms: refresh failed, serving the last good copy: ${String(error)}`));
      }
      return value.data;
    },
    invalidate() {
      if (value) value = { ...value, at: Number.NEGATIVE_INFINITY };
    },
  };
}

let cache: ReturnType<typeof swrCache<CmsPost[]>> | undefined;
let cachedFor: string | undefined;

/** Every live post, from memory when it can. */
export function getCmsPosts(settings: CmsSettings): Promise<CmsPost[]> {
  const key = `${settings.url}|${settings.apiKey}`;
  if (!cache || cachedFor !== key) {
    cache = swrCache(() => fetchCmsPosts(settings), FRESH_MS);
    cachedFor = key;
  }
  return cache.get();
}

/** Marks the posts stale: the next request reads the CMS. */
export function invalidateCmsPosts(): void {
  cache?.invalidate();
}

/** The CMS's image sizes (apps/cms/src/collections/media.ts). */
export type ImageSize = 'cover' | 'cover-small' | 'share' | 'inline' | 'inline-small';

/**
 * An image's URL in one of the CMS's sizes, on the CMS's public host, or the
 * original when that size was not made (an image smaller than the size).
 */
export function assetUrl(settings: Pick<CmsSettings, 'publicUrl'>, file: MediaFile, size: ImageSize): string {
  const url = file.sizes?.[size]?.url ?? file.url;
  // Payload answers with its own server URL or a path; either way the browser loads it from the public host.
  const { pathname, search } = new URL(url, 'http://cms');
  return `${settings.publicUrl.replace(/\/+$/, '')}${pathname}${search}`;
}
