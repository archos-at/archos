import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { LEGACY_ORGANIZATION_SETTING, LEGACY_USER_SETTING } from "./legacy-tenant-settings";
import {
  MissingTenantContextError,
  ORGANIZATION_SETTING,
  PLATFORM_ROLE,
  USER_SETTING,
  getTenantContext,
  type TenantContext,
} from "./tenant-context";

let client: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

const DEFAULT_DB_POOL_MAX = 10;
const STATEMENT_TIMEOUT_MS = 30_000;

export function resolveDbPoolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (!raw) return DEFAULT_DB_POOL_MAX;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DB_POOL_MAX;
}

type Connection = postgres.TransactionSql<Record<string, never>>;

const SAFE_SETTING_VALUE = /^[A-Za-z0-9_-]*$/;

const UNSCOPED_CLIENT_MEMBERS = new Set(["reserve", "listen", "notify", "file", "subscribe"]);

const SLOT_WAIT_WARN_MS = 1_000;
const SLOT_WAIT_LOG_INTERVAL_MS = 60_000;
let lastSlotWaitLogAt = 0;

function reportSlotWait(waitedMs: number): void {
  if (waitedMs < SLOT_WAIT_WARN_MS) return;
  const now = Date.now();
  if (now - lastSlotWaitLogAt < SLOT_WAIT_LOG_INTERVAL_MS) return;
  lastSlotWaitLogAt = now;
  console.warn(
    `[db] waited ${Math.round(waitedMs)}ms for a connection from a pool of ` +
      `${resolveDbPoolMax()} (DB_POOL_MAX). Callers queue silently past this ` +
      `bound; if this persists, raise the bound or find what is holding slots.`,
  );
}

function settingLiteral(name: string, value: string): string {
  if (!SAFE_SETTING_VALUE.test(value)) {
    throw new Error(`[db] refusing to set ${name}: value is not a plain identifier`);
  }
  return `SET LOCAL "${name}" = '${value}'`;
}

export function contextStatement(context: TenantContext): string {
  const timeout = `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}'`;
  if (context.kind === "platform") {
    return [`SET LOCAL ROLE ${PLATFORM_ROLE}`, timeout].join("; ");
  }
  return [
    settingLiteral(ORGANIZATION_SETTING, context.organizationId),
    settingLiteral(LEGACY_ORGANIZATION_SETTING, context.organizationId),
    settingLiteral(USER_SETTING, context.userId ?? ""),
    settingLiteral(LEGACY_USER_SETTING, context.userId ?? ""),
    timeout,
  ].join("; ");
}

async function applyContext(connection: Connection, context: TenantContext): Promise<void> {
  await connection.unsafe(contextStatement(context));
}

interface PendingQuery<T> extends PromiseLike<T> {
  values(): Promise<T>;
  execute(): Promise<T>;
}

function tenantScopedClient(base: ReturnType<typeof postgres>): ReturnType<typeof postgres> {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "unsafe") {
        return (query: string, params?: unknown[], options?: unknown): PendingQuery<unknown> => {
          const context = getTenantContext();
          if (!context) throw new MissingTenantContextError();

          const started: { rows?: Promise<unknown>; values?: Promise<unknown> } = {};
          const run = (positional: boolean): Promise<unknown> => {
            const key = positional ? "values" : "rows";
            const requestedAt = performance.now();
            started[key] ??= target.begin(async (connection) => {
              reportSlotWait(performance.now() - requestedAt);
              await applyContext(connection, context);
              const pending = connection.unsafe(
                query,
                params as never,
                options as never,
              ) as unknown as PendingQuery<unknown>;
              return positional ? await pending.values() : await pending;
            }) as Promise<unknown>;
            return started[key];
          };

          return {
            values: () => run(true),
            execute: () => run(false),
            then: (resolve, reject) => run(false).then(resolve, reject),
          } as PendingQuery<unknown>;
        };
      }

      if (property === "begin") {
        return (fn: (connection: Connection) => Promise<unknown>) => {
          const context = getTenantContext();
          if (!context) return Promise.reject(new MissingTenantContextError());
          const requestedAt = performance.now();
          return target.begin(async (connection) => {
            reportSlotWait(performance.now() - requestedAt);
            await applyContext(connection, context);
            return fn(connection);
          });
        };
      }

      if (UNSCOPED_CLIENT_MEMBERS.has(property as string)) {
        return () => {
          throw new Error(
            `[db] client.${String(property)}() bypasses the tenant context. Use getDb() ` +
              `inside withTenant()/withPlatformAccess(), or add an interception here.`,
          );
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },

    apply() {
      throw new Error(
        "[db] the raw postgres client is not callable through this proxy — every " +
          "statement must go through getDb() so it carries a tenant context.",
      );
    },
  }) as ReturnType<typeof postgres>;
}

export function createDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const connectionString = process.env.APP_DATABASE_URL;

  if (!connectionString) {
    throw new Error("APP_DATABASE_URL is not defined");
  }

  client = postgres(connectionString, {
    max: resolveDbPoolMax(),
    connect_timeout: 10,
    idle_timeout: 30,
    prepare: false,
  });
  dbInstance = drizzle(tenantScopedClient(client));

  return dbInstance;
}

export function getDb() {
  if (!dbInstance) {
    return createDb();
  }

  return dbInstance;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    dbInstance = null;
  }
}
