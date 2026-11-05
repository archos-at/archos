#!/usr/bin/env node
/**
 * Drafts a LinkedIn post per language from a week's summary in
 * releasenotes/summaries.yaml (the public changelog's source, ADR-0154), linking
 * the changelog. Drafts only: a person edits and approves them in the CMS.
 * Keyed by `sourceRef`, so a re-run creates what is missing and never
 * overwrites a draft someone has worked on.
 *
 *   node social/release-summaries.mjs --week 2026-W44                 # dry run, offline
 *   CMS_URL=… CMS_DRAFTING_API_KEY=… SITE_URL=https://… \
 *     node social/release-summaries.mjs --week 2026-W44 --apply
 *
 * The German text is the summary's translation in releasenotes/translations/de.json.
 * CMS_DRAFTING_API_KEY is the API key of a user who drafts (an editor or the
 * agent): the CMS lets that key write drafts and nothing more.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { cmsFromEnv } from './cms-client.mjs';

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
export function summaryPost(week, text, language, siteUrl, account = ACCOUNT) {
  return {
    status: 'draft',
    account,
    language,
    text,
    linkUrl: new URL(language === 'en' ? '/en/changelog/' : '/changelog/', siteUrl).href,
    utmCampaign: `changelog-${week.toLowerCase()}`,
    sourceRef: `release-summary:${week}:${language}`,
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
  if (!process.env.CMS_URL) {
    for (const d of drafts) console.log(`would draft ${d.sourceRef}: ${d.text.slice(0, 80)}…`);
    return;
  }
  const cms = cmsFromEnv('CMS_DRAFTING_API_KEY');
  const [account] = await cms.find('social-accounts', { where: { key: { equals: ACCOUNT } } });
  if (!account) throw new Error(`No social account ${ACCOUNT} in the CMS.`);
  for (const draft of drafts) {
    const existing = await cms.find('social-posts', { where: { sourceRef: { equals: draft.sourceRef } }, depth: 0 });
    if (existing.length > 0) {
      console.log(`exists   ${draft.sourceRef}`);
      continue;
    }
    if (apply) await cms.create('social-posts', { ...draft, account: account.id });
    console.log(`${apply ? 'drafted ' : 'would draft'} ${draft.sourceRef}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
