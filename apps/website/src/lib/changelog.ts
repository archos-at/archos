import rss from '@astrojs/rss';
import changelog from '../data/changelog.json';
import copy from '../i18n/pages/changelog';
import { localePath, type Locale } from '../i18n/paths';
import identity, { withName } from './identity';

/**
 * The public changelog shown at /changelog/ and /en/changelog/: one editorial summary per week.
 *
 * `src/data/changelog.json` is GENERATED: `scripts/release_notes.py publish` reads the reno notes in
 * `releasenotes/notes/` and the weekly summaries in `releasenotes/summaries.yaml`, translates new
 * sentences into German once, and the release-notes workflow commits the result on every merge to
 * `develop`. Nothing here reads git or calls a translator at build time, which keeps the web image
 * build hermetic. Never edit the JSON by hand.
 *
 * The public tier holds the summaries and nothing else (ADR-0154): every single note is for signed-in
 * customers, in the app's "What's new". A week without a summary is not in the file. See
 * docs/contributing/release-notes.md.
 */

/** One string in both site languages. */
export interface Bilingual {
  en: string;
  de: string;
}

export interface ChangelogRelease {
  /** A tag (`1.2.0`) or, while nothing is tagged, the ISO week the notes shipped in (`2026-W39`). */
  id: string;
  kind: 'version' | 'week';
  version: string | null;
  /** A week's Monday, or a version's ship date. */
  date: string | null;
  /** A week's Sunday; null for a version. */
  dateEnd: string | null;
  /** The editorial summary of the week (releasenotes/summaries.yaml): the whole public entry. */
  summary: Bilingual;
}

export interface ChangelogData {
  releases: ChangelogRelease[];
}

const data = changelog as ChangelogData;

/** Every summarised release, newest first, as the publisher wrote them. */
export function getReleases(source: ChangelogData = data): ChangelogRelease[] {
  return source.releases;
}

/**
 * The heading of one release: its version when the repository tagged one, otherwise the week the
 * notes shipped in as a date range ("26. Oktober – 1. November 2026"). A release without a date
 * exists only in a local preview; the caller passes the label for it.
 */
export function releaseTitle(release: ChangelogRelease, locale: Locale, unreleasedLabel: string): string {
  if (release.kind === 'version' && release.version) return release.version;
  if (!release.date) return unreleasedLabel;
  const format = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-AT', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const start = new Date(`${release.date}T00:00:00Z`);
  if (!release.dateEnd) return format.format(start);
  return format.formatRange(start, new Date(`${release.dateEnd}T00:00:00Z`));
}

/** The anchor a release is linked by (`#r-2026-W44`); the old site used the same, so old links still land. */
export const releaseAnchor = (release: ChangelogRelease): string => `r-${release.id}`;

/** The changelog's feed, per locale: `/changelog/rss.xml` and `/en/changelog/rss.xml`. */
export const feedPath = (locale: Locale): string => `${localePath('changelog', locale)}rss.xml`;

/**
 * The public changelog of one locale as RSS 2.0 (`@astrojs/rss`), one item per summarised week,
 * newest first. An item links to its week's anchor and is dated by the week's last day, when it
 * was complete.
 */
export function changelogFeed(locale: Locale, site: URL | undefined, source: ChangelogData = data) {
  const c = withName(copy[locale]);
  const page = localePath('changelog', locale);
  return rss({
    title: c.feed.title,
    description: c.meta.description,
    site: new URL(page, site ?? `https://${identity.domain}`).href,
    trailingSlash: false,
    customData: locale === 'de' ? '<language>de-at</language>' : '<language>en</language>',
    items: getReleases(source).map((release) => ({
      title: releaseTitle(release, locale, c.unreleased),
      description: release.summary[locale],
      pubDate: new Date(`${release.dateEnd ?? release.date ?? '1970-01-01'}T00:00:00Z`),
      link: `${page}#${releaseAnchor(release)}`,
    })),
  });
}
