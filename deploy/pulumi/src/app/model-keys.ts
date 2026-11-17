import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type { ModelWorkload } from "../config/app-services";
import type { DeployConfig } from "../config";

type EnvVar = k8s.types.input.core.v1.EnvVar;

export const OPENROUTER_SECRET_KEY: Record<ModelWorkload, string> = {
  chat: "OPENROUTER_API_KEY", // pragma: allowlist secret (Secret key name, not a credential)
  research: "OPENROUTER_RESEARCH_API_KEY", // pragma: allowlist secret (Secret key name, not a credential)
  ingest: "OPENROUTER_INGEST_API_KEY", // pragma: allowlist secret (Secret key name, not a credential)
};

export const OPENROUTER_KEY_ENV = ["OPENROUTER_API_KEY", "EMBED_API_KEY", "VLM_API_KEY"] as const;

export function openrouterSecretValues(cfg: DeployConfig): Record<string, pulumi.Input<string>> {
  const keys = cfg.llm.openrouterKeys;
  return {
    [OPENROUTER_SECRET_KEY.chat]: keys.chat,
    [OPENROUTER_SECRET_KEY.research]: keys.research,
    [OPENROUTER_SECRET_KEY.ingest]: keys.ingest,
  };
}

export function openrouterKeyEnv(workload: ModelWorkload, secretName: string): EnvVar[] {
  const key = OPENROUTER_SECRET_KEY[workload];
  return OPENROUTER_KEY_ENV.map((name) => ({ name, valueFrom: { secretKeyRef: { name: secretName, key } } }));
}
