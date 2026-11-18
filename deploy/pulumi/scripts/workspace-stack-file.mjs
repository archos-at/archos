#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dump, load } from "js-yaml";

const LEGACY = "grid-oib";
const PROJECT = "workspace";
const OVERRIDES = { namespace: "workspace" };

export function workspaceStackFile(text) {
  const doc = load(text) ?? {};
  const config = {};
  const droppedSecure = [];
  for (const [key, value] of Object.entries(doc.config ?? {})) {
    const local = key.startsWith(`${LEGACY}:`) ? key.slice(LEGACY.length + 1) : undefined;
    if (value !== null && typeof value === "object" && "secure" in value) {
      droppedSecure.push(local ?? key);
      continue;
    }
    config[local === undefined ? key : `${PROJECT}:${local}`] = value;
  }
  for (const [key, value] of Object.entries(OVERRIDES)) config[`${PROJECT}:${key}`] = value;
  const environment = (doc.environment ?? []).map((env) =>
    typeof env === "string" && env.startsWith(`${LEGACY}/`) ? `${PROJECT}/${env.slice(LEGACY.length + 1)}` : env,
  );
  const out = { ...doc, ...(environment.length ? { environment } : {}), config };
  return { text: dump(out, { lineWidth: -1, noRefs: true }), droppedSecure };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === "--secure-keys") {
    const { droppedSecure } = workspaceStackFile(readFileSync(process.argv[3], "utf8"));
    if (droppedSecure.length) console.log(droppedSecure.join("\n"));
    process.exit(0);
  }
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error("usage: workspace-stack-file.mjs <legacy stack file> <out>");
    process.exit(2);
  }
  const { text, droppedSecure } = workspaceStackFile(readFileSync(src, "utf8"));
  writeFileSync(dest, `# Generated from ${src} by scripts/workspace-stack-file.mjs (ADR-0147). Do not edit.\n${text}`);
  console.log(`wrote ${dest}; secure keys left for ESC: ${droppedSecure.join(", ") || "none"}`);
}
