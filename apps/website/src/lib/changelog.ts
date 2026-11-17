import rss from '@astrojs/rss';
import changelog from '../data/changelog.json';
import copy from '../i18n/pages/changelog';
import { localePath, type Locale } from '../i18n/paths';
import identity, { withName } from './identity';

export interface Bilingual {
  en: string;
  de: string;
}

export interface ChangelogRelease {
  id: string;
  kind: 'version' | 'week';
  version: string | null;
  date: string | null;
  dateEnd: string | null;
  summary: Bilingual;
}

export interface ChangelogData {
  releases: ChangelogRelease[];
}

const data = changelog as ChangelogData;

export function getReleases(source: ChangelogData = data): ChangelogRelease[] {
  return source.releases;
}

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

export const releaseAnchor = (release: ChangelogRelease): string => `r-${release.id}`;

export const feedPath = (locale: Locale): string => `${localePath('changelog', locale)}rss.xml`;

export function changelogFeed(locale: Locale, site: URL | undefined, source: ChangelogData = data) {
  const c = withName(copy[locale]);
  const page = localePath('changelog', locale);
  return rss({
    title: c.feed.rssTitle,
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
