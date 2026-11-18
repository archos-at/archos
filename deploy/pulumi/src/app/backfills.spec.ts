import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBackfills, sqlFiles } from "./backfills";

const MARKER = "drop after release 2026-W50";

function registry(entries: Record<string, { manifest: string; files?: Record<string, string> }>): string {
  const dir = mkdtempSync(join(tmpdir(), "backfills-"));
  writeFileSync(join(dir, "run-sql.sh"), "#!/bin/sh\n");
  for (const [name, { manifest, files }] of Object.entries(entries)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "backfill.json"), manifest);
    for (const [file, text] of Object.entries(files ?? {})) writeFileSync(join(dir, name, file), text);
  }
  return dir;
}

const sql = (extra = "") =>
  `{"expires": "${MARKER}",\n  "kind": "sql",\n  "phase": "after-switch",\n  "dryRun": "dry-run.sql",\n  "apply": "apply.sql"${extra}\n}\n`;
const SQL_FILES = { "dry-run.sql": "SELECT 'a', 0;", "apply.sql": "SELECT 1;" };

describe("the backfill registry", () => {
  it("reads every registered backfill in the repository", () => {
    const all = loadBackfills();
    expect(all.map((b) => b.name)).toEqual(
      expect.arrayContaining(["actor-kind", "inbox-types", "lanes", "mention-ids", "qdrant-document-id"]),
    );
    expect(all.find((b) => b.name === "qdrant-document-id")).toMatchObject({ kind: "qdrant", phase: "before-readers" });
  });

  it("reads a SQL backfill and its files, in name order", () => {
    const dir = registry({ "b-two": { manifest: sql(), files: SQL_FILES }, "a-one": { manifest: sql(), files: SQL_FILES } });
    const all = loadBackfills(dir);
    expect(all.map((b) => b.name)).toEqual(["a-one", "b-two"]);
    expect(Object.keys(sqlFiles(all, dir)).sort()).toEqual([
      "a-one.apply.sql",
      "a-one.dry-run.sql",
      "b-two.apply.sql",
      "b-two.dry-run.sql",
      "run-sql.sh",
    ]);
  });

  it("refuses a manifest whose first line does not carry the expiry marker", () => {
    const manifest = `{\n  "expires": "${MARKER}",\n  "kind": "sql", "phase": "after-switch", "dryRun": "dry-run.sql", "apply": "apply.sql"\n}\n`;
    expect(() => loadBackfills(registry({ x: { manifest, files: SQL_FILES } }))).toThrow(/first line/);
  });

  it("refuses an expiry that is not a release week", () => {
    const manifest = sql().replace(MARKER, "drop after release soon");
    expect(() => loadBackfills(registry({ x: { manifest, files: SQL_FILES } }))).toThrow(/YYYY-Www/);
  });

  it("refuses an unknown phase or kind, and a missing file", () => {
    expect(() => loadBackfills(registry({ x: { manifest: sql().replace("after-switch", "whenever"), files: SQL_FILES } }))).toThrow(
      /phase must be/,
    );
    expect(() => loadBackfills(registry({ x: { manifest: sql().replace('"sql"', '"redis"'), files: SQL_FILES } }))).toThrow(
      /kind must be/,
    );
    expect(() => loadBackfills(registry({ x: { manifest: sql(), files: { "dry-run.sql": "" } } }))).toThrow(/apply must name/);
  });

  it("refuses a Qdrant backfill without a command", () => {
    const manifest = `{"expires": "${MARKER}",\n  "kind": "qdrant",\n  "phase": "before-readers",\n  "command": []\n}\n`;
    expect(() => loadBackfills(registry({ x: { manifest } }))).toThrow(/command/);
  });
});
