import * as pulumi from "@pulumi/pulumi";
import { bool, num } from "../config/readers";

// The provider answers 402 to every caller of a key once its in-flight requests could exceed the balance (2026-11-02).
export type ModelWorkload = "chat" | "research" | "ingest";

export const OPENROUTER_KEY_CONFIG: Record<ModelWorkload, string> = {
  chat: "openrouterChatKey",
  research: "openrouterResearchKey",
  ingest: "openrouterIngestKey",
};

export interface LlmConfig {
  openrouterKeys: Record<ModelWorkload, pulumi.Output<string>>;
  tavilyApiKey: pulumi.Output<string>;
  embedModel: string;
  embedBaseUrl: string;
  vlmModel: string;
  vlmBaseUrl: string;
}

export interface AuthConfig {
  requireAuth: boolean;
  workosClientId: string;
  workosAuthkitDomain: string;
  workosApiKey: pulumi.Output<string>;
  workosCookiePassword: pulumi.Output<string>;
  platformOwnerEmails: string;
  platformOrgExternalId: string;
  disableSelfServeOrgs: boolean;
  auditLogsEnabled: boolean;
  byokSecretBackend: string;
  byokLocalKek: pulumi.Output<string>;
  allowAgentOrgMemory: boolean;
  knowledgeSingleOperator: boolean;
  knowledgeCarry: boolean;
}

export interface InternalConfig {
  apiToken: pulumi.Output<string>;
  adminToken: pulumi.Output<string>;
  corpusExportToken: pulumi.Output<string>;
  jobPayloadKek: pulumi.Output<string>;
}

export interface WebPushConfig {
  publicKey: string;
  privateKey: pulumi.Output<string>;
  subject: string;
}

export interface SkillsConfig {
  minIntervalMinutes: number;
}

function openrouterKeys(cfg: pulumi.Config): Record<ModelWorkload, pulumi.Output<string>> {
  const shared = cfg.requireSecret("openrouterApiKey");
  const own = (workload: ModelWorkload) => cfg.getSecret(OPENROUTER_KEY_CONFIG[workload]) ?? shared;
  return { chat: own("chat"), research: own("research"), ingest: own("ingest") };
}

export function loadAppServices(
  cfg: pulumi.Config,
): { llm: LlmConfig; auth: AuthConfig; internal: InternalConfig; webPush: WebPushConfig; skills: SkillsConfig } {
  const jobPayloadKek = cfg.getSecret("jobPayloadKek");
  const allowPlaintextJobPayloads = bool(cfg, "allowPlaintextJobPayloads", false);
  if (jobPayloadKek === undefined && !allowPlaintextJobPayloads) {
    throw new Error(
      "The DB-claimed research queue persists job payloads (which carry the user auth token) in Postgres, " +
        "so they must be encrypted at rest. Set a 32-byte base64 KEK:\n" +
        "  pulumi config set --secret grid-oib:jobPayloadKek $(openssl rand -base64 32)\n" +
        "To deliberately run with PLAINTEXT payloads (dev/single-node only), set:\n" +
        "  pulumi config set grid-oib:allowPlaintextJobPayloads true",
    );
  }
  const workosClientId = cfg.get("workosClientId") ?? "";
  const workosApiKey = cfg.getSecret("workosApiKey");
  return {
    llm: {
      openrouterKeys: openrouterKeys(cfg),
      tavilyApiKey: cfg.requireSecret("tavilyApiKey"),
      embedModel: cfg.get("embedModel") ?? "openai/text-embedding-3-large",
      embedBaseUrl: cfg.get("embedBaseUrl") ?? "https://openrouter.ai/api/v1",
      vlmModel: cfg.get("vlmModel") ?? "openai/gpt-6-luna",
      vlmBaseUrl: cfg.get("vlmBaseUrl") ?? "https://openrouter.ai/api/v1",
    },
    auth: {
      requireAuth: bool(cfg, "requireAuth", true),
      workosClientId,
      workosAuthkitDomain: cfg.get("workosAuthkitDomain") ?? "",
      workosApiKey: workosApiKey ?? pulumi.output(""),
      workosCookiePassword: cfg.getSecret("workosCookiePassword") ?? pulumi.output(""),
      platformOwnerEmails: cfg.get("platformOwnerEmails") ?? "",
      platformOrgExternalId: cfg.get("platformOrgExternalId") ?? "grid-platform",
      disableSelfServeOrgs: bool(cfg, "disableSelfServeOrgs", false),
      auditLogsEnabled: bool(cfg, "auditLogsEnabled", false),
      byokSecretBackend: cfg.get("byokSecretBackend") ?? "",
      byokLocalKek: cfg.getSecret("byokLocalKek") ?? pulumi.output(""),
      allowAgentOrgMemory: bool(cfg, "allowAgentOrgMemory", false),
      knowledgeSingleOperator: bool(cfg, "knowledgeSingleOperator", false),
      knowledgeCarry: bool(cfg, "knowledgeCarry", false),
    },
    internal: {
      apiToken: cfg.requireSecret("gridInternalApiToken"),
      adminToken: cfg.requireSecret("gridAdminToken"),
      corpusExportToken: cfg.getSecret("gridCorpusExportToken") ?? pulumi.output(""),
      jobPayloadKek: jobPayloadKek ?? pulumi.output(""),
    },
    webPush: {
      publicKey: cfg.get("webPushVapidPublicKey") ?? "",
      privateKey: cfg.getSecret("webPushVapidPrivateKey") ?? pulumi.output(""),
      subject: cfg.get("webPushSubject") ?? "",
    },
    skills: {
      minIntervalMinutes: num(cfg, "skillMinIntervalMinutes", 15),
    },
  };
}
