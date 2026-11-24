#!/usr/bin/env node
// Usage: summarize-plan.mjs plan.json [summary.md]. Exits 1 on a plan that loses data, unless ALLOW_STATE_LOSS=1.
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HOLDS_STATE = [
  "kubernetes:core/v1:Namespace",
  "kubernetes:core/v1:PersistentVolumeClaim",
  "kubernetes:apps/v1:StatefulSet",
  "kubernetes:postgresql.cnpg.io/v1:Cluster",
];

const CHANGES = ["create", "update", "replace", "delete"];

function kindOf(step) {
  if (step.op === "create-replacement" || step.op === "delete-replaced") return "replace";
  return step.op;
}

function typeOf(urn) {
  return urn.split("::")[2] ?? "";
}

function nameOf(urn) {
  return urn.split("::").at(-1) ?? urn;
}

export function summarize(plan) {
  const byKind = Object.fromEntries(CHANGES.map((kind) => [kind, []]));
  for (const step of plan.steps ?? []) {
    const kind = kindOf(step);
    if (!(kind in byKind)) continue;
    if (byKind[kind].some((seen) => seen.urn === step.urn)) continue;
    byKind[kind].push({ urn: step.urn, type: typeOf(step.urn), name: nameOf(step.urn), reasons: step.diffReasons ?? [] });
  }
  const destructive = [...byKind.replace, ...byKind.delete];
  const losesState = destructive.filter((change) => HOLDS_STATE.includes(change.type));
  return { byKind, destructive, losesState };
}

export function markdown({ byKind, losesState }) {
  const lines = ["### Pulumi preview against staging", ""];
  lines.push(`| create | update | replace | delete |`, `|---|---|---|---|`);
  lines.push(`| ${CHANGES.map((kind) => byKind[kind].length).join(" | ")} |`, "");
  for (const kind of CHANGES) {
    if (byKind[kind].length === 0) continue;
    lines.push(`<details${kind === "replace" || kind === "delete" ? " open" : ""}><summary>${kind} (${byKind[kind].length})</summary>`, "");
    for (const change of byKind[kind]) {
      const why = change.reasons.length ? ` (${change.reasons.join(", ")})` : "";
      lines.push(`- \`${change.type}\` ${change.name}${why}`);
    }
    lines.push("", "</details>", "");
  }
  if (losesState.length) {
    lines.push("**This plan replaces or deletes a resource that holds data.** Label the pull request `infra:destroys-state` only if that is meant.");
  }
  return lines.join("\n");
}

function main([planPath, summaryPath]) {
  if (!planPath) {
    console.error("usage: summarize-plan.mjs <plan.json> [summary.md]");
    return 2;
  }
  const result = summarize(JSON.parse(readFileSync(planPath, "utf8")));
  const text = markdown(result);
  console.log(text);
  if (summaryPath) appendFileSync(summaryPath, `${text}\n`);
  for (const change of result.destructive) console.log(`::warning title=Pulumi plan::${change.urn} is ${result.byKind.delete.includes(change) ? "deleted" : "replaced"}`);
  if (result.losesState.length === 0) return 0;
  if (process.env.ALLOW_STATE_LOSS === "1") {
    console.log("::notice::the pull request is labelled infra:destroys-state; the replacement or deletion of data is accepted");
    return 0;
  }
  for (const change of result.losesState) console.log(`::error title=Pulumi plan::${change.urn} holds data and would be replaced or deleted`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
