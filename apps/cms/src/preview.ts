/**
 * Live preview of a draft on the website (ADR-0155). The admin panel frames the
 * website's preview page with a link this module signs; the page asks the CMS
 * for exactly that draft with the same signature (`previewEndpoint`), so the
 * website holds no credential that reads drafts, and a link stops working after
 * `PREVIEW_TTL_S`.
 *
 * The signature is HMAC-SHA256 over `<id>.<locale>.<expiry>` with
 * `CMS_PREVIEW_SECRET`, which the website holds too
 * (apps/website/src/lib/cms-preview.ts verifies nothing; it forwards). Without the
 * secret or the website's address there is no preview button.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Endpoint } from 'payload';
import { canDraft } from './access/roles';
import { LOCALES, type Locale } from './fields/choices';

export const PREVIEW_TTL_S = 60 * 60;

export interface PreviewSettings {
  /** Where an editor's browser reaches the website, e.g. https://example.com. */
  websiteUrl: string;
  secret: string;
}

export function previewSettings(env: Record<string, string | undefined> = process.env): PreviewSettings | undefined {
  const websiteUrl = env.WEBSITE_PUBLIC_URL?.trim();
  const secret = env.CMS_PREVIEW_SECRET?.trim();
  return websiteUrl && secret ? { websiteUrl, secret } : undefined;
}

export function previewSignature(secret: string, id: string, locale: string, expires: number): string {
  return createHmac('sha256', secret).update(`${id}.${locale}.${expires}`).digest('hex');
}

/** The website's preview page for one post in one language. */
export function previewUrl(settings: PreviewSettings, id: string, locale: Locale, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + PREVIEW_TTL_S;
  const url = new URL(locale === 'en' ? '/en/blog/preview/' : '/blog/preview/', settings.websiteUrl);
  url.search = new URLSearchParams({ id, locale, expires: String(expires), signature: previewSignature(settings.secret, id, locale, expires) }).toString();
  return url.href;
}

/** Whether a signature is this module's, for this post, language and expiry, and not expired. */
export function verifyPreview(secret: string, query: { id?: string; locale?: string; expires?: string; signature?: string }, now = Date.now()): boolean {
  const { id, locale, expires, signature } = query;
  if (!id || !locale || !expires || !signature || !LOCALES.includes(locale as Locale)) return false;
  const expiry = Number(expires);
  if (!Number.isInteger(expiry) || expiry * 1000 < now) return false;
  const expected = Buffer.from(previewSignature(secret, id, locale, expiry));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** `GET /api/posts/preview?id=&locale=&expires=&signature=`: the newest draft, every language, for a signed link. */
export const previewEndpoint: Endpoint = {
  path: '/preview',
  method: 'get',
  handler: async (req) => {
    const settings = previewSettings();
    const query = Object.fromEntries(new URL(req.url ?? '', 'http://cms').searchParams) as Record<string, string>;
    // Signed in to the admin panel, a person may preview without a link; the website needs the signature.
    if (!canDraft(req.user) && !(settings && verifyPreview(settings.secret, query))) {
      return Response.json({ errors: [{ message: 'Not a valid preview link.' }] }, { status: 403 });
    }
    const post = await req.payload.findByID({ collection: 'posts', id: query.id, draft: true, locale: 'all', depth: 1, overrideAccess: true, req });
    return Response.json(post, { headers: { 'Cache-Control': 'no-store' } });
  },
};

/** The admin panel's live preview: the website's preview page, or none without the settings. */
export function livePreviewUrl({ data, locale }: { data: { id?: number | string }; locale?: { code: string } | string }) {
  const settings = previewSettings();
  const code = (typeof locale === 'string' ? locale : locale?.code) as Locale | undefined;
  if (!settings || data?.id === undefined) return null;
  return previewUrl(settings, String(data.id), code && LOCALES.includes(code) ? code : 'de');
}
