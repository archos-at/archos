/**
 * Provision the row-level-security roles, for deployments that have no
 * declarative role manager (ADR-0041).
 *
 * Kubernetes does not need this: CloudNativePG reconciles `managed.roles`
 * continuously. Compose does, and the gap is an UPGRADE break rather than a
 * fresh-install one: `init-db.sql` runs only when Postgres initialises a fresh
 * data directory, so on an existing volume the roles never appear — and
 * migration 0030 then aborts with "row-level security roles are missing",
 * taking the container with it.
 *
 * So this runs BEFORE `drizzle-kit migrate`, with the migration credential
 * (a superuser in compose), and:
 *
 *   1. creates the platform and the runtime role if they are absent,
 *   2. grants the membership that makes the platform step-up legal,
 *   3. syncs the runtime role's password to whatever `APP_DATABASE_URL` says.
 *
 * Each role has two names (ADR-0145 rule 5): `app_platform` and `app_rw`, and
 * before the deploy renamed them, `grid_app_platform` and `grid_app_rw`. The
 * migrations written before the rename grant to the old names, so a role that
 * exists under neither is created under the OLD one, and the Compose service
 * `postgres-rename-roles` renames it once the migrations have run
 * (`deploy/postgres/rename-legacy-names.sh after-migrate`).
 *
 * The password is not a separate variable to keep in sync: it is read from the
 * URL the app is about to connect with, so the two cannot drift.
 *
 * Fail-soft on every path that is merely "not applicable" — a single-credential
 * local checkout, or a deployment whose credential lacks CREATEROLE (Kubernetes,
 * where this is not needed anyway). It must never block a boot it was not
 * required for; the app's own connection attempt is the real gate and reports a
 * far clearer error.
 */

import postgres from "postgres";

/** Only ever these roles, new name and old — never a name taken from a URL. */
const RUNTIME_ROLES = { current: "app_rw", legacy: "grid_app_rw" };
const PLATFORM_ROLES = { current: "app_platform", legacy: "grid_app_platform" };

const runtimeUrl = process.env.APP_DATABASE_URL;
const ownerUrl = process.env.APP_MIGRATION_DATABASE_URL;

function log(message) {
  console.log(`[ensure-rls-roles] ${message}`);
}

if (!runtimeUrl || !ownerUrl) {
  log(`${runtimeUrl ? "APP_MIGRATION_DATABASE_URL" : "APP_DATABASE_URL"} not set — nothing to do.`);
  process.exit(0);
}

let parsed;
try {
  parsed = new URL(runtimeUrl);
} catch {
  log("APP_DATABASE_URL is not a parseable URL — leaving it to the app to report.");
  process.exit(0);
}

const runtimeUser = decodeURIComponent(parsed.username || "");
const runtimePassword = decodeURIComponent(parsed.password || "");

if (runtimeUser !== RUNTIME_ROLES.current && runtimeUser !== RUNTIME_ROLES.legacy) {
  log(`runtime user is "${runtimeUser}", not ${RUNTIME_ROLES.current} — skipping.`);
  process.exit(0);
}
if (!runtimePassword) {
  log(`no password in APP_DATABASE_URL — assuming trust auth, skipping.`);
  process.exit(0);
}

const sql = postgres(ownerUrl, { max: 1, prepare: false, connect_timeout: 10 });

/** The name a role has in this database: the new one, else the old, else null. */
async function existingName(names) {
  const rows = await sql`SELECT rolname FROM pg_roles WHERE rolname IN (${names.current}, ${names.legacy})`;
  const found = new Set(rows.map((row) => row.rolname));
  return found.has(names.current) ? names.current : found.has(names.legacy) ? names.legacy : null;
}

let RUNTIME_ROLE = RUNTIME_ROLES.legacy;
let PLATFORM_ROLE = PLATFORM_ROLES.legacy;
try {
  RUNTIME_ROLE = (await existingName(RUNTIME_ROLES)) ?? RUNTIME_ROLES.legacy;
  PLATFORM_ROLE = (await existingName(PLATFORM_ROLES)) ?? PLATFORM_ROLES.legacy;
  await sql.unsafe(`CREATE ROLE ${PLATFORM_ROLE} NOLOGIN BYPASSRLS`).catch((error) => {
    if (!/already exists/i.test(error.message)) throw error;
  });

  const [existing] = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}`;

  if (!existing) {
    const [created] = await sql`
      SELECT format(
        'CREATE ROLE %I LOGIN NOINHERIT PASSWORD %L', ${RUNTIME_ROLE}::text, ${runtimePassword}::text
      ) AS statement
    `;
    await sql.unsafe(created.statement);
    log(`created ${RUNTIME_ROLE} and ${PLATFORM_ROLE}.`);
  } else {
    const [built] = await sql`
      SELECT format('ALTER ROLE %I LOGIN NOINHERIT PASSWORD %L', ${RUNTIME_ROLE}::text, ${runtimePassword}::text) AS statement
    `;
    await sql.unsafe(built.statement);
    log(`${RUNTIME_ROLE} login synchronised with APP_DATABASE_URL.`);
  }

  await sql.unsafe(`GRANT ${PLATFORM_ROLE} TO ${RUNTIME_ROLE}`);
} catch (error) {
  log(`could not provision the row-level-security roles (${error.message}) — continuing.`);
  log(`if migration 0030 then reports missing roles, create them as an admin:`);
  log(`  CREATE ROLE ${PLATFORM_ROLE} NOLOGIN BYPASSRLS;`);
  log(`  CREATE ROLE ${RUNTIME_ROLE} LOGIN NOINHERIT PASSWORD '<the one in APP_DATABASE_URL>';`);
  log(`  GRANT ${PLATFORM_ROLE} TO ${RUNTIME_ROLE};`);
} finally {
  await sql.end({ timeout: 5 });
}
