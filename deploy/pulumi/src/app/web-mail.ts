import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import type { DeployConfig } from "../config";
import { secretChecksum, secretChecksumAnnotations } from "../platform/rollout";

export const WEB_MAIL_SECRET = "web-mail"; // pragma: allowlist secret

export function installWebMailSecret(cfg: DeployConfig, provider: k8s.Provider, namespace: string, dependsOn: pulumi.Resource[]) {
  const { smtp, attioApiKey } = cfg.websiteMail;
  if (!smtp && !attioApiKey) return undefined;
  return new k8s.core.v1.Secret(
    WEB_MAIL_SECRET,
    {
      metadata: { name: WEB_MAIL_SECRET, namespace },
      stringData: {
        ...(smtp ? { SMTP_PASSWORD: smtp.password } : {}),
        ...(attioApiKey ? { ATTIO_API_KEY: attioApiKey } : {}),
      },
    },
    { provider, dependsOn },
  );
}

export function webMailEnv(cfg: DeployConfig): k8s.types.input.core.v1.EnvVar[] {
  const { smtp, attioApiKey } = cfg.websiteMail;
  const fromSecret = (name: string) => ({ name, valueFrom: { secretKeyRef: { name: WEB_MAIL_SECRET, key: name } } });
  return [
    ...(smtp ? [{ name: "SMTP_USER", value: smtp.user }, fromSecret("SMTP_PASSWORD")] : []),
    ...(attioApiKey ? [fromSecret("ATTIO_API_KEY")] : []),
  ];
}

export function webMailPodAnnotations(cfg: DeployConfig): Record<string, pulumi.Input<string>> {
  const { smtp, attioApiKey } = cfg.websiteMail;
  if (!smtp && !attioApiKey) return {};
  return secretChecksumAnnotations(
    secretChecksum({
      SMTP_USER: smtp?.user ?? "",
      SMTP_PASSWORD: smtp?.password ?? "",
      ATTIO_API_KEY: attioApiKey ?? "",
    }),
  );
}
