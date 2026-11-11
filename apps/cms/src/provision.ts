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
 *   CMS_PLATFORM_MCP_API_KEY             the platform MCP gateway's MCP key, bound to an agent account
 *
 * A variable that is unset leaves its account as it is.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import type { Role } from './access/roles';
import { DEFAULT_ACCOUNT_KEY } from './jobs/draft-social-posts';
import { MCP_OPTIONS } from './mcp';

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
  const found = await payload.find({ collection: 'users', where: { email: { equals: robot.email } }, limit: 1 });
  const desired = { name: robot.name, role: robot.role, enableAPIKey: true, apiKey };
  const existing = found.docs[0];
  // Payload keeps the key encrypted and finds it by this index (payload/dist/auth/strategies/apiKey.js).
  const index = createHmac('sha256', payload.secret).update(apiKey).digest('hex');
  const holdsKey = async (id: number) =>
    (await payload.count({ collection: 'users', where: { and: [{ id: { equals: id } }, { apiKeyIndex: { equals: index } }] } })).totalDocs === 1;
  if (!existing) {
    await payload.create({ collection: 'users', data: { email: robot.email, password: randomPassword(), ...desired } });
    log(`created ${robot.email}`);
  } else if (existing.role !== robot.role || !existing.enableAPIKey || !(await holdsKey(existing.id))) {
    await payload.update({ collection: 'users', id: existing.id, data: desired });
    log(`updated ${robot.email}`);
  }
}

/**
 * The agent account behind the platform MCP gateway's `/cms/mcp` (ADR-0154):
 * platform staff's agents reach the CMS through the gateway, which presents
 * this one key. The account is an `agent`, so every write is a draft.
 */
export const GATEWAY_AGENT = { email: 'platform-mcp@robots.cms.invalid', name: 'Platform MCP gateway', keyVariable: 'CMS_PLATFORM_MCP_API_KEY' };

/** Every operation `MCP_OPTIONS` offers, switched on: the key may do what the server offers and the role allows. */
export function gatewayKeyGrants(): Record<string, Record<string, boolean>> {
  const camel = (slug: string) => slug.replace(/[-_\s]+(.)?/g, (_, chr?: string) => (chr ? chr.toUpperCase() : ''));
  return Object.fromEntries(
    Object.entries(MCP_OPTIONS.collections ?? {}).map(([slug, settings]) => {
      const enabled = typeof settings?.enabled === 'object' ? settings.enabled : {};
      return [camel(slug), Object.fromEntries(Object.entries(enabled).filter(([, on]) => on === true))];
    }),
  );
}

async function ensureGatewayKey(payload: Payload, env: Env, log: (line: string) => void) {
  const apiKey = env[GATEWAY_AGENT.keyVariable]?.trim();
  if (!apiKey) return;
  const agent = { email: GATEWAY_AGENT.email, name: GATEWAY_AGENT.name, role: 'agent' as const };
  const found = await payload.find({ collection: 'users', where: { email: { equals: agent.email } }, limit: 1 });
  const user = found.docs[0] ?? (await payload.create({ collection: 'users', data: { ...agent, password: randomPassword() } }));
  if (user.role !== 'agent') await payload.update({ collection: 'users', id: user.id, data: { role: 'agent' } });
  const index = createHmac('sha256', payload.secret).update(apiKey).digest('hex');
  const keys = await payload.find({ collection: 'payload-mcp-api-keys', where: { user: { equals: user.id } }, limit: 1 });
  const desired = { user: user.id, label: GATEWAY_AGENT.name, enableAPIKey: true, apiKey, ...gatewayKeyGrants() };
  const existing = keys.docs[0];
  if (!existing) {
    await payload.create({ collection: 'payload-mcp-api-keys', data: desired as never });
    log(`created the MCP key of ${agent.email}`);
    return;
  }
  const holds = (await payload.count({ collection: 'payload-mcp-api-keys', where: { and: [{ id: { equals: existing.id } }, { apiKeyIndex: { equals: index } }] } })).totalDocs === 1;
  if (!holds) {
    await payload.update({ collection: 'payload-mcp-api-keys', id: existing.id, data: desired as never });
    log(`rotated the MCP key of ${agent.email}`);
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
  await ensureGatewayKey(payload, env, log);
  await ensureAccounts(payload, log);
}
