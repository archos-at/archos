import type { CmsPost, MediaFile } from './post-model';

export const FRESH_MS = 60_000;
const TIMEOUT_MS = 5_000;

export interface CmsSettings {
  url: string;
  apiKey: string;
  publicUrl: string;
}

export function cmsSettings(env: Record<string, string | undefined> = process.env): CmsSettings | undefined {
  const url = env.CMS_URL?.trim();
  const apiKey = env.CMS_API_KEY?.trim();
  if (!url || !apiKey) return undefined;
  return { url, apiKey, publicUrl: env.CMS_PUBLIC_URL?.trim() || url };
}

export const authorization = (settings: Pick<CmsSettings, 'apiKey'>) => `users API-Key ${settings.apiKey}`;

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

export function getCmsPosts(settings: CmsSettings): Promise<CmsPost[]> {
  const key = `${settings.url}|${settings.apiKey}`;
  if (!cache || cachedFor !== key) {
    cache = swrCache(() => fetchCmsPosts(settings), FRESH_MS);
    cachedFor = key;
  }
  return cache.get();
}

export function invalidateCmsPosts(): void {
  cache?.invalidate();
}

export type ImageSize = 'cover' | 'cover-small' | 'share' | 'inline' | 'inline-small';

export function assetUrl(settings: Pick<CmsSettings, 'publicUrl'>, file: MediaFile, size: ImageSize): string {
  const url = file.sizes?.[size]?.url ?? file.url;
  const { pathname, search } = new URL(url, 'http://cms');
  return `${settings.publicUrl.replace(/\/+$/, '')}${pathname}${search}`;
}
