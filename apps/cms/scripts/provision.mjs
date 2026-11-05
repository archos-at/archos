#!/usr/bin/env node
/**
 * What the CMS needs beyond its sync files (`directus/`), which hold schema and
 * configuration but no rows and no secrets: the two locales, the company's
 * LinkedIn account, and the robot users whose static tokens other systems use.
 * Idempotent; run after every `d6s sync push` (the deploy's config Job does).
 *
 *   DIRECTUS_URL=… DIRECTUS_ADMIN_TOKEN=… \
 *   CMS_WEBSITE_TOKEN=… CMS_SOCIAL_HANDOFF_TOKEN=… node scripts/provision.mjs
 *
 * A robot whose token variable is unset is left as it is, so a stack that has
 * not set up social publishing yet is not failed by it.
 */
import { directusFromEnv, query } from './lib/directus.mjs';

export const LANGUAGES = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
];

/** Created when missing and never overwritten: the channel id is set in the Studio once the account is connected. */
export const SOCIAL_ACCOUNTS = [{ id: 'linkedin-company', label: 'LinkedIn company page', network: 'linkedin', max_length: 3000, active: true }];

/** Robot users: API only (no Studio seat), each with the one role its job needs. */
export const ROBOTS = [
  { email: 'website@robots.example.com', first_name: 'Website', role: 'Website', tokenVariable: 'CMS_WEBSITE_TOKEN' },
  { email: 'social-handoff@robots.example.com', first_name: 'Social hand-off', role: 'Social hand-off', tokenVariable: 'CMS_SOCIAL_HANDOFF_TOKEN' },
];

async function upsertMissing(cms, collection, key, rows) {
  for (const row of rows) {
    const found = await cms.get(`/items/${collection}${query({ filter: { [key]: { _eq: row[key] } }, fields: key })}`);
    if (found.length > 0) continue;
    await cms.post(`/items/${collection}`, row);
    console.log(`created ${collection} ${row[key]}`);
  }
}

async function provisionRobot(cms, robot, env) {
  const token = env[robot.tokenVariable];
  if (!token) {
    console.log(`skipped ${robot.email}: ${robot.tokenVariable} is unset`);
    return;
  }
  const roles = await cms.get(`/roles${query({ filter: { name: { _eq: robot.role } }, fields: 'id' })}`);
  if (roles.length !== 1) throw new Error(`Role "${robot.role}" not found: push the sync files first.`);
  const desired = { first_name: robot.first_name, role: roles[0].id, token, status: 'active' };
  const users = await cms.get(`/users${query({ filter: { email: { _eq: robot.email } }, fields: 'id' })}`);
  if (users.length === 0) {
    await cms.post('/users', { email: robot.email, ...desired });
    console.log(`created ${robot.email}`);
  } else {
    await cms.patch(`/users/${users[0].id}`, desired);
    console.log(`updated ${robot.email}`);
  }
}

export async function provision(env = process.env) {
  const cms = directusFromEnv('DIRECTUS_ADMIN_TOKEN', env);
  await upsertMissing(cms, 'languages', 'code', LANGUAGES);
  await upsertMissing(cms, 'social_accounts', 'id', SOCIAL_ACCOUNTS);
  for (const robot of ROBOTS) await provisionRobot(cms, robot, env);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  provision().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
