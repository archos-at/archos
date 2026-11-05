/**
 * The blog's posts from the CMS (Directus, ADR-0155), read server-side with the
 * website's read-only token and kept in memory, stale-while-revalidate:
 *
 * - fresh for `FRESH_MS`: served from memory;
 * - older: served from memory while one request refreshes it in the background;
 * - CMS unreachable: the last good copy keeps being served, and the failure is logged;
 * - `invalidateCmsPosts()` (the CMS's `Refresh the website` flow calls
 *   /api/cms/revalidate) marks the copy stale, so the next request refreshes it.
 *
 * Each web pod holds its own copy: a publish shows at once on the pod the flow
 * reached and within `FRESH_MS` on the others.
 *
 * The query asks for what is live (`published`, publish date passed) even though
 * the token can read nothing else, so a token with wider rights can never leak
 * a draft onto the site.
 */
import type { CmsPost } from './post-model';

export const FRESH_MS = 60_000;
const TIMEOUT_MS = 5_000;

export interface CmsSettings {
  /** Where the website reaches Directus (inside the cluster: http://directus.cms.svc.cluster.local:8055). */
  url: string;
  token: string;
  /** Where a visitor's browser reaches its assets: https://cms.<domain>. */
  publicUrl: string;
}

/** The CMS this server reads, or undefined: then the site serves the MDX fixtures in src/content/blog. */
export function cmsSettings(env: Record<string, string | undefined> = process.env): CmsSettings | undefined {
  const url = env.CMS_URL?.trim();
  const token = env.CMS_TOKEN?.trim();
  if (!url || !token) return undefined;
  return { url, token, publicUrl: env.CMS_PUBLIC_URL?.trim() || url };
}

const BLOCK_FIELDS = {
  block_markdown: ['text'],
  block_figure: ['component', 'props'],
  block_image: ['image', 'alt', 'caption', 'ai_generated'],
  block_quote: ['quote', 'name', 'role', 'office'],
  block_cta: ['title', 'text', 'primary', 'secondary'],
};

export const POST_FIELDS = [
  'id', 'publish_date', 'date_updated', 'category', 'cover_type', 'cover', 'cover_image', 'cover_alt', 'cover_ai_generated',
  'author.name', 'author.job_title', 'author.profile_url',
  'translations.languages_code', 'translations.title', 'translations.slug', 'translations.description',
  'translations.seo_title', 'translations.seo_description', 'translations.noindex', 'translations.previous_slugs',
  'translations.blocks.collection',
  ...Object.entries(BLOCK_FIELDS).flatMap(([collection, fields]) => fields.map((f) => `translations.blocks.item:${collection}.${f}`)),
];

/** The request for every live post, newest first, blocks in their order. */
export function postsUrl(settings: CmsSettings): string {
  const params = new URLSearchParams({
    fields: POST_FIELDS.join(','),
    filter: JSON.stringify({ _and: [{ status: { _eq: 'published' } }, { publish_date: { _lte: '$NOW' } }] }),
    deep: JSON.stringify({ translations: { blocks: { _sort: ['sort'] } } }),
    sort: '-publish_date',
    limit: '-1',
  });
  return `${settings.url.replace(/\/+$/, '')}/items/blog_posts?${params}`;
}

export async function fetchCmsPosts(settings: CmsSettings, fetchImpl: typeof fetch = fetch): Promise<CmsPost[]> {
  const res = await fetchImpl(postsUrl(settings), {
    headers: { Authorization: `Bearer ${settings.token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The CMS answered ${res.status} for the blog posts`);
  const body = (await res.json()) as { data?: CmsPost[] };
  if (!Array.isArray(body.data)) throw new Error('The CMS answered without a list of posts');
  return body.data;
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
  const key = `${settings.url}|${settings.token}`;
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

/** A CMS file's URL through one of its transform presets (apps/cms settings: cover, cover-small, share, inline, inline-small). */
export function assetUrl(settings: Pick<CmsSettings, 'publicUrl'>, file: string, preset: string): string {
  return `${settings.publicUrl.replace(/\/+$/, '')}/assets/${encodeURIComponent(file)}?key=${encodeURIComponent(preset)}`;
}
