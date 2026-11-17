export function baseStackConfig(): Record<string, string> {
  return {
    "grid-oib:kubeconfig": "apiVersion: v1",
    "grid-oib:baseDomain": "example.test",
    "grid-oib:storageClass": "premium",
    "grid-oib:letsEncryptEmail": "ops@example.test",
    "grid-oib:seaweedfsSecretKey": "s3-secret", // pragma: allowlist secret
    "grid-oib:seaweedfsBackendReadSecretKey": "read-secret", // pragma: allowlist secret
    "grid-oib:seaweedfsFilerDbPassword": "filer-secret", // pragma: allowlist secret
    "grid-oib:seaweedfsTenantAdminSecretKey": "tenant-secret", // pragma: allowlist secret
    "grid-oib:pgAppPassword": "pg-secret", // pragma: allowlist secret
    "grid-oib:pgRuntimePassword": "rw-secret", // pragma: allowlist secret
    "grid-oib:workosApiKey": "workos", // pragma: allowlist secret
    "grid-oib:workosClientId": "client",
    "grid-oib:workosCookiePassword": "cookie-cookie-cookie-cookie-cookie-x", // pragma: allowlist secret
    "grid-oib:gridInternalApiToken": "internal", // pragma: allowlist secret
    "grid-oib:gridAdminToken": "admin", // pragma: allowlist secret
    "grid-oib:tavilyApiKey": "tavily", // pragma: allowlist secret
    "grid-oib:openrouterApiKey": "or", // pragma: allowlist secret
    "grid-oib:dragonflyPassword": "df", // pragma: allowlist secret
    "grid-oib:rateLimitStorePassword": "rl", // pragma: allowlist secret
    "grid-oib:qdrantApiKey": "qd-rw", // pragma: allowlist secret
    "grid-oib:qdrantReadOnlyApiKey": "qd-ro", // pragma: allowlist secret
    "grid-oib:qdrantS3SecretKey": "qd-s3", // pragma: allowlist secret
    "grid-oib:allowPlaintextJobPayloads": "true",
  };
}

export function langfuseStackConfig(): Record<string, string> {
  return {
    "grid-oib:langfuseEnabled": "true",
    "grid-oib:langfuseEncryptionKey":
      "0".repeat(64), // pragma: allowlist secret
    "grid-oib:langfuseSalt": "lf-salt", // pragma: allowlist secret
    "grid-oib:langfuseNextAuthSecret": "lf-nextauth", // pragma: allowlist secret
    "grid-oib:langfusePublicKey": "pk-lf-test", // pragma: allowlist secret
    "grid-oib:langfuseSecretKey": "sk-lf-test", // pragma: allowlist secret
    "grid-oib:langfuseDbPassword": "lf-db", // pragma: allowlist secret
    "grid-oib:langfuseClickhousePassword": "lf-ch-dev", // pragma: allowlist secret
    "grid-oib:langfuseQueuePassword": "lf-queue", // pragma: allowlist secret
    "grid-oib:langfuseS3SecretKey": "lf-s3", // pragma: allowlist secret
    "grid-oib:langfuseInitUserPassword": "lf-init-user", // pragma: allowlist secret
    "grid-oib:otelOidcIssuer": "https://grid.authkit.app",
    "grid-oib:otelOidcClientId": "client_otel",
    "grid-oib:otelOidcClientSecret": "otel-client-secret", // pragma: allowlist secret
  };
}

export function forProject(config: Record<string, string>, project: string): Record<string, string> {
  return Object.fromEntries(Object.entries(config).map(([k, v]) => [k.replace(/^grid-oib:/, `${project}:`), v]));
}
