import { describe, expect, test } from 'bun:test';
import { changelogFeed, feedPath, getReleases, releaseAnchor, releaseTitle, type ChangelogRelease } from './changelog';

const week: ChangelogRelease = {
  id: '2026-W44',
  kind: 'week',
  version: null,
  date: '2026-10-26',
  dateEnd: '2026-11-01',
  summary: { en: 'The week in short.', de: 'Die Woche kurz.' },
};

describe('changelog', () => {
  test('a week is titled by its date range, in the reader’s language', () => {
    expect(releaseTitle(week, 'de', 'In Kürze')).toBe('26. Oktober – 1. November 2026');
    expect(releaseTitle(week, 'en', 'Coming up')).toBe('26 October – 1 November 2026');
  });

  test('a tagged version is titled by its version, an undated release by the given label', () => {
    expect(releaseTitle({ ...week, kind: 'version', version: '1.2.0', dateEnd: null }, 'de', 'x')).toBe('1.2.0');
    expect(releaseTitle({ ...week, date: null, dateEnd: null }, 'en', 'Coming up')).toBe('Coming up');
  });

  test('anchors keep the old site’s form, so shared links still land', () => {
    expect(releaseAnchor(week)).toBe('r-2026-W44');
  });

  test('the committed data is summaries only, newest first, each in both languages', () => {
    const releases = getReleases();
    expect(releases.length).toBeGreaterThan(0);
    const dates = releases.map((r) => r.date ?? '9999');
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const release of releases) {
      // The public tier carries no single note (ADR-0154): the summary is the entry.
      expect(Object.keys(release).sort()).toEqual(['date', 'dateEnd', 'id', 'kind', 'summary', 'version']);
      expect(release.summary.de.length).toBeGreaterThan(0);
      expect(release.summary.en.length).toBeGreaterThan(0);
    }
  });

  test('the feed has one item per week, linked to its anchor', async () => {
    expect(feedPath('de')).toBe('/changelog/rss.xml');
    expect(feedPath('en')).toBe('/en/changelog/rss.xml');
    const response = await changelogFeed('de', new URL('https://example.test'), { releases: [week] });
    const xml = await response.text();
    expect(xml).toContain('<description>Die Woche kurz.</description>');
    expect(xml).toContain('https://example.test/changelog/#r-2026-W44');
  });
});
