/**
 * What the CMS needs beyond its schema: the first administrator, the robots
 * whose API keys other systems hold, and the company's LinkedIn account. Run on
 * every start (`onInit` in payload.config.ts) and by `bun run provision`;
 * idempotent, and it never overwrites what a person changed, except a robot's
 * key, which the deployment owns and rotates.
 *
 *   CMS_ADMIN_EMAIL, CMS_ADMIN_PASSWORD  the first administrator, created only while there is no user
 *   CMS_WEBSITE_API_KEY                  the website's key (role `website`)
 *   CMS_SOCIAL_HANDOFF_API_KEY           the Buffer hand-off's key (role `social-handoff`)
 *
 * A variable that is unset leaves its account as it is.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import type { Role } from './access/roles';
import { DEFAULT_ACCOUNT_KEY } from './jobs/draft-social-posts';

export const ROBOTS: ReadonlyArray<{ email: string; name: string; role: Role; keyVariable: string }> = [
  { email: 'website@robots.cms.invalid', name: 'Website', role: 'website', keyVariable: 'CMS_WEBSITE_API_KEY' },
  { email: 'social-handoff@robots.cms.invalid', name: 'Social hand-off', role: 'social-handoff', keyVariable: 'CMS_SOCIAL_HANDOFF_API_KEY' },
];

/** Created when missing and never overwritten: Buffer's channel id is set in the admin panel once the page is connected. */
export const SOCIAL_ACCOUNTS = [
  { key: DEFAULT_ACCOUNT_KEY, label: 'LinkedIn company page', network: 'linkedin' as const, maxLength: 3000, active: true },
];

type Env = Record<string, string | undefined>;
const randomPassword = () => randomBytes(32).toString('base64url');

async function ensureAdmin(payload: Payload, env: Env, log: (line: string) => void) {
  const email = env.CMS_ADMIN_EMAIL?.trim();
  const password = env.CMS_ADMIN_PASSWORD;
  if (!email || !password) return;
  const { totalDocs } = await payload.count({ collection: 'users', where: { role: { equals: 'admin' } } });
  if (totalDocs > 0) return;
  await payload.create({ collection: 'users', data: { email, password, name: 'Administrator', role: 'admin' } });
  log(`created the administrator ${email}`);
}

async function ensureRobot(payload: Payload, robot: (typeof ROBOTS)[number], env: Env, log: (line: string) => void) {
  const apiKey = env[robot.keyVariable]?.trim();
  if (!apiKey) return;
  const found = await payload.find({ collection: 'users', where: { email: { equals: robot.email } }, limit: 1, showHiddenFields: true });
  const desired = { name: robot.name, role: robot.role, enableAPIKey: true, apiKey };
  const existing = found.docs[0] as { id: number | string; role?: string; apiKeyIndex?: string | null; enableAPIKey?: boolean | null } | undefined;
  // Payload keeps the key encrypted and finds it by this index (payload/dist/auth/strategies/apiKey.js).
  const index = createHmac('sha256', payload.secret).update(apiKey).digest('hex');
  if (!existing) {
    await payload.create({ collection: 'users', data: { email: robot.email, password: randomPassword(), ...desired } });
    log(`created ${robot.email}`);
  } else if (existing.role !== robot.role || existing.apiKeyIndex !== index || !existing.enableAPIKey) {
    await payload.update({ collection: 'users', id: existing.id, data: desired });
    log(`updated ${robot.email}`);
  }
}

async function ensureAccounts(payload: Payload, log: (line: string) => void) {
  for (const account of SOCIAL_ACCOUNTS) {
    const { totalDocs } = await payload.count({ collection: 'social-accounts', where: { key: { equals: account.key } } });
    if (totalDocs > 0) continue;
    await payload.create({ collection: 'social-accounts', data: account });
    log(`created the social account ${account.key}`);
  }
}

export async function provision(payload: Payload, env: Env = process.env, log: (line: string) => void = (line) => payload.logger.info(line)) {
  await ensureAdmin(payload, env, log);
  for (const robot of ROBOTS) await ensureRobot(payload, robot, env, log);
  await ensureAccounts(payload, log);
}
