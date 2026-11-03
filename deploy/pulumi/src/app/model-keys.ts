/**
 * Which OpenRouter key each workload spends from.
 *
 * One key shared by every tier let a bulk ingest hold the whole balance in
 * flight, and OpenRouter answered 402 to chat, research and ingest in the same
 * minute (2026-10-12, 10-19, 11-02). Each workload now reads its own stack
 * secret (`openrouterChatKey`, `openrouterResearchKey`, `openrouterIngestKey`,
 * each falling back to `openrouterApiKey`), which an operator gives its own
 * credit limit in OpenRouter.
 *
 * The pod sees its key under the names the code already reads:
 * `OPENROUTER_API_KEY` (the agent runtime's config, provider inference in
 * `common/credential_resolution.py`, the reranker, the BFF's model catalog),
 * `EMBED_API_KEY` and `VLM_API_KEY`. An organization's own key (BYOK) still
 * wins over all three, because resolution asks for it first.
 */
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { ModelWorkload } from "../config/app-services";
import type { DeployConfig } from "../config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

/**
 * The key in the shared Secret that holds each workload's OpenRouter key.
 * `chat` keeps `OPENROUTER_API_KEY`, the name every pod referenced before the
 * split, so a pod of the previous release restarting mid-rollout still finds it.
 */
export const OPENROUTER_SECRET_KEY: Record<ModelWorkload, string> = {
  chat: "OPENROUTER_API_KEY", // pragma: allowlist secret (Secret key name, not a credential)
  research: "OPENROUTER_RESEARCH_API_KEY", // pragma: allowlist secret (Secret key name, not a credential)
  ingest: "OPENROUTER_INGEST_API_KEY", // pragma: allowlist secret (Secret key name, not a credential)
};

/** The env names a backend pod reads its OpenRouter key under, all from one workload's key. */
export const OPENROUTER_KEY_ENV = ["OPENROUTER_API_KEY", "EMBED_API_KEY", "VLM_API_KEY"] as const;

/** The shared Secret's entries: one per workload. */
export function openrouterSecretValues(cfg: DeployConfig): Record<string, pulumi.Input<string>> {
  const keys = cfg.llm.openrouterKeys;
  return {
    [OPENROUTER_SECRET_KEY.chat]: keys.chat,
    [OPENROUTER_SECRET_KEY.research]: keys.research,
    [OPENROUTER_SECRET_KEY.ingest]: keys.ingest,
  };
}

/** A backend pod's key env: every name in {@link OPENROUTER_KEY_ENV} from `workload`'s key only. */
export function openrouterKeyEnv(workload: ModelWorkload, secretName: string): EnvVar[] {
  const key = OPENROUTER_SECRET_KEY[workload];
  return OPENROUTER_KEY_ENV.map((name) => ({ name, valueFrom: { secretKeyRef: { name: secretName, key } } }));
}
