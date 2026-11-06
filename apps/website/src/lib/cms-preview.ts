/**
 * A draft for the CMS's live preview (ADR-0155). The admin panel frames
 * `/blog/preview/?id=…&locale=…&expires=…&signature=…`, a link the CMS signed
 * (apps/cms/src/preview.ts). The website verifies nothing itself and holds no
 * credential that reads drafts: it forwards the four parameters to the CMS,
 * which answers with exactly that draft while the signature holds, and with 403
 * otherwise. Never cached.
 */
import type { CmsSettings } from './cms';
import type { CmsPost } from './post-model';

const PARAMS = ['id', 'locale', 'expires', 'signature'] as const;
const TIMEOUT_MS = 5_000;

/** The CMS request for the draft a preview link names, or undefined when the link lacks a part. */
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
