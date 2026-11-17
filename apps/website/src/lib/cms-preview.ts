import type { CmsSettings } from './cms';
import type { CmsPost } from './post-model';

const PARAMS = ['id', 'locale', 'expires', 'signature'] as const;
const TIMEOUT_MS = 5_000;

export function previewRequestUrl(settings: Pick<CmsSettings, 'url'>, search: URLSearchParams): string | undefined {
  const params = new URLSearchParams();
  for (const name of PARAMS) {
    const value = search.get(name);
    if (!value) return undefined;
    params.set(name, value);
  }
  return `${settings.url.replace(/\/+$/, '')}/api/posts/preview?${params}`;
}

export async function fetchPreviewPost(settings: CmsSettings, search: URLSearchParams, fetchImpl: typeof fetch = fetch): Promise<CmsPost | undefined> {
  const url = previewRequestUrl(settings, search);
  if (!url) return undefined;
  const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return undefined;
  return (await res.json()) as CmsPost;
}
