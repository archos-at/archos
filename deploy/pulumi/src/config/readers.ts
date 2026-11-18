import * as pulumi from "@pulumi/pulumi";

export function num(cfg: pulumi.Config, key: string, fallback: number): number {
  const v = cfg.getNumber(key);
  return v === undefined ? fallback : v;
}

export function positiveInt(cfg: pulumi.Config, key: string, fallback: number): number {
  const v = num(cfg, key, fallback);
  if (!Number.isInteger(v) || v < 1) {
    throw new Error(`grid-oib:${key} must be a whole number of at least 1 (got ${v}).`);
  }
  return v;
}

export function bool(cfg: pulumi.Config, key: string, fallback: boolean): boolean {
  const v = cfg.getBoolean(key);
  return v === undefined ? fallback : v;
}

export function percent(cfg: pulumi.Config, key: string, fallback: number): number {
  const v = num(cfg, key, fallback);
  if (!Number.isInteger(v) || v <= 0 || v >= 100) {
    throw new Error(`grid-oib:${key} must be a whole percentage between 1 and 99 (got ${v}).`);
  }
  return v;
}

export function nodeGroup(cfg: pulumi.Config, key: string): string | undefined {
  const value = cfg.get(key)?.trim();
  if (!value) return undefined;
  if (value.length > 63 || !/^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/.test(value)) {
    throw new Error(`grid-oib:${key} must be a Kubernetes label value, the worker group's name (got "${value}").`);
  }
  return value;
}

export function requireSecretsTogether(
  cfg: pulumi.Config,
  keys: string[],
  because: string,
): void {
  const missing = keys.filter((key) => (cfg.get(key) ?? "").trim() === "");
  if (missing.length === 0) return;
  throw new Error(
    `${missing.map((k) => `grid-oib:${k}`).join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
      `required ${because}. Set ${missing.length === 1 ? "it" : "them"} with ` +
      `\`pulumi config set --secret\`.`,
  );
}
