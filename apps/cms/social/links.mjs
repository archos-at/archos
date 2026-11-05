/**
 * The tracked link a social post carries, and the share image it shows.
 *
 * UTM convention (ADR-0155), lower-case, words joined by hyphens, so PostHog's
 * automatic `utm_*` properties group cleanly:
 *
 *   utm_source   the network:                  linkedin
 *   utm_medium   organic posts:                social      (paid posts, later: paid-social)
 *   utm_campaign the blog post's slug, or the post's own campaign (`changelog-2026-w44`)
 *   utm_content  the account and the post:     linkedin-company-1a2b3c4d
 *
 * `utm_content` tells two posts for the same article apart (two accounts, or a
 * second wording a week later), which is what an A/B read of the copy needs.
 */

export const UTM_MEDIUM = 'social';

/** `/blog/<slug>/` or `/en/blog/<slug>/`, as apps/website/src/lib/categories.ts builds it. */
export function blogPostPath(locale, slug) {
  return `${locale === 'en' ? '/en/blog/' : '/blog/'}${slug}/`;
}

/** The share image the website renders for a cover (apps/website/src/pages/media/covers/[id].png.ts). */
export function shareImageUrl(siteUrl, cover) {
  return new URL(`/media/covers/${cover}.png`, siteUrl).href;
}

/** `url` with the post's UTM parameters; any it already carries are replaced. */
export function trackedLink(url, { network, campaign, accountId, postId }) {
  const link = new URL(url);
  for (const key of [...link.searchParams.keys()]) if (key.startsWith('utm_')) link.searchParams.delete(key);
  link.searchParams.set('utm_source', network);
  link.searchParams.set('utm_medium', UTM_MEDIUM);
  link.searchParams.set('utm_campaign', campaign);
  link.searchParams.set('utm_content', `${accountId}-${String(postId).slice(0, 8)}`);
  return link.href;
}
