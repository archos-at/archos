import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.APP_MIGRATION_DATABASE_URL ?? process.env.APP_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("APP_MIGRATION_DATABASE_URL or APP_DATABASE_URL is required");
}

export default defineConfig({
  schema: "./bff/db/schema/*.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
