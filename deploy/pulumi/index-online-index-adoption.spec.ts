import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseSql, readSql, type SqlStatement, type SqlToken } from "../../apps/workspace/tests/test-utils/sql-statements";
import { ONLINE_INDEXES } from "./src/app/online-indexes-job";

const MIGRATIONS = resolve(__dirname, "../../apps/workspace/migrations");

function migrationFile(migration: string): string | undefined {
  return readdirSync(MIGRATIONS).find((file) => file.startsWith(`${migration}_`) && /(?<!\.down)\.sql$/.test(file));
}

function withBodies(statements: SqlStatement[]): SqlStatement[] {
  return statements.flatMap((statement) => [
    statement,
    ...statement.tokens.filter((token) => token.kind === "string").flatMap((token) => withBodies(parseSql(token.text))),
  ]);
}

const isWord = (token: SqlToken | undefined, word: string): boolean =>
  token?.kind === "word" && token.text.toUpperCase() === word;

function adoptedIndexes(statements: SqlStatement[]): Array<{ constraint: string; index: string }> {
  return withBodies(statements).flatMap(({ tokens }) =>
    tokens.flatMap((token, i) => {
      if (!isWord(token, "USING") || !isWord(tokens[i + 1], "INDEX")) return [];
      const constraint = tokens.slice(0, i).reverse().find((t, j, before) => isWord(before[j + 1], "CONSTRAINT"));
      return [{ constraint: constraint?.text ?? "", index: tokens[i + 2]?.text ?? "" }];
    }),
  );
}

describe("an index the deploy builds online", () => {
  it.each(ONLINE_INDEXES.map((ix) => [ix.name, ix] as const))("%s is adopted by its migration under that name", (_, ix) => {
    const file = migrationFile(ix.migration);
    expect(file, `migration ${ix.migration}`).toBeDefined();
    expect(adoptedIndexes(readSql(resolve(MIGRATIONS, file!)))).toContainEqual({ constraint: ix.name, index: ix.name });
  });
});
