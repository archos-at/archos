#!/usr/bin/env node
/**
 * Drafts a LinkedIn post per language from a week's summary in
 * releasenotes/summaries.yaml (the public changelog's source, ADR-0154), linking
 * the changelog. Drafts only: a person edits and approves them in the CMS.
 * Keyed by `source_ref`, so a re-run creates what is missing and never
 * overwrites a draft someone has worked on.
 *
 *   node social/release-summaries.mjs --week 2026-W44                 # dry run, offline
 *   DIRECTUS_URL=… CMS_DRAFTING_TOKEN=… SITE_URL=https://… \
 *     node social/release-summaries.mjs --week 2026-W44 --apply
 *
 * The German text is the summary's translation in releasenotes/translations/de.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { directusFromEnv, query } from '../scripts/lib/directus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASENOTES = path.resolve(HERE, '../../../releasenotes');
const ACCOUNT = 'linkedin-company';

const normalise = (text) => text.replace(/\s+/g, ' ').trim();

/** `{ en, de }` of one week's summary; `de` is undefined until it is translated. */
export function weekSummary(week, dir = RELEASENOTES) {
  const summaries = YAML.parse(readFileSync(path.join(dir, 'summaries.yaml'), 'utf8'));
  const en = summaries[week];
  if (!en) throw new Error(`No summary for ${week} in releasenotes/summaries.yaml`);
  const translations = JSON.parse(readFileSync(path.join(dir, 'translations/de.json'), 'utf8'));
  const de = translations.find((t) => normalise(t.en) === normalise(en))?.de;
  return { en: normalise(en), de: de && normalise(de) };
}

/** The draft for one language. */
export function summaryPost(week, text, language, siteUrl) {
  return {
    status: 'draft',
    account: ACCOUNT,
    language,
    text,
    link_url: new URL(language === 'en' ? '/en/changelog/' : '/changelog/', siteUrl).href,
    utm_campaign: `changelog-${week.toLowerCase()}`,
    source_ref: `release-summary:${week}:${language}`,
  };
}

function parseArgs(argv) {
  const week = argv[argv.indexOf('--week') + 1];
  if (!argv.includes('--week') || !/^\d{4}-W\d{2}$/.test(week ?? '')) throw new Error('Pass --week YYYY-Www.');
  return { week, apply: argv.includes('--apply') };
}

async function main() {
  const { week, apply } = parseArgs(process.argv.slice(2));
  const siteUrl = process.env.SITE_URL ?? 'https://example.com';
  const summary = weekSummary(week);
  const drafts = Object.entries(summary)
    .filter(([, text]) => text)
    .map(([language, text]) => summaryPost(week, text, language, siteUrl));
  if (!summary.de) console.log(`${week} has no German translation yet; drafting English only.`);
  if (!process.env.DIRECTUS_URL) {
    for (const d of drafts) console.log(`would draft ${d.source_ref}: ${d.text.slice(0, 80)}…`);
    return;
  }
  const cms = directusFromEnv('CMS_DRAFTING_TOKEN');
  for (const draft of drafts) {
    const existing = await cms.get(`/items/social_posts${query({ filter: { source_ref: { _eq: draft.source_ref } }, fields: 'id' })}`);
    if (existing.length > 0) {
      console.log(`exists   ${draft.source_ref}`);
      continue;
    }
    if (apply) await cms.post('/items/social_posts', draft);
    console.log(`${apply ? 'drafted ' : 'would draft'} ${draft.source_ref}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
