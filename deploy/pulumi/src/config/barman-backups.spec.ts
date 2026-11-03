import { describe, it, expect } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { baseStackConfig } from "../test-support/stack-config";
import { PRODUCTION_STACK } from "./barman-backups";

/**
 * Where the app cluster's PITR archive may go.
 *
 * Production archives the app cluster to the in-cluster SeaweedFS, the single
 * pod that restarted five times on 2026-11-02, on the same Delete-reclaim
 * storage as the database. Both refusals here are about plans that deploy
 * cleanly and leave no restorable archive: one that keeps the app's archive in
 * the cluster after an off-cluster bucket exists, and one that points an
 * external bucket at SeaweedFS's credentials.
 */
pulumi.runtime.setMocks(
  { newResource: (args) => ({ id: `${args.name}-id`, state: args.inputs }), call: () => ({}) },
  "grid-oib",
  PRODUCTION_STACK,
  false,
);

async function planWith(values: Record<string, string>): Promise<Error | null> {
  pulumi.runtime.setAllConfig({ ...baseStackConfig(), ...values });
  const { loadConfig } = await import("../config");
  try {
    loadConfig();
    return null;
  } catch (error) {
    return error as Error;
  }
}

/** Production's archive as `Pulumi.prod.yaml` sets it today: on, default (in-cluster) endpoint. */
const PROD_TODAY = {
  "grid-oib:pgBackupsEnabled": "true",
  "grid-oib:pgBackupRetention": "30d",
};

/** The background-work cluster archiving off-cluster (ADR-0150): the stack has an external bucket. */
const BACKGROUND_WORK_OFFSITE = {
  "grid-oib:backgroundWorkPgBackupsEnabled": "true",
  "grid-oib:backgroundWorkPgBackupEndpoint": "https://s3.offsite.example.test",
  "grid-oib:backgroundWorkPgBackupBucket": "background-work-pg-backups",
  "grid-oib:backgroundWorkPgBackupAccessKey": "bw-access",
  "grid-oib:backgroundWorkPgBackupSecretKey": "bw-secret", // pragma: allowlist secret
};

const APP_OFFSITE = {
  "grid-oib:pgBackupEndpoint": "https://s3.offsite.example.test",
  "grid-oib:pgBackupBucket": "grid-pg-backups",
  "grid-oib:pgBackupAccessKey": "pg-access",
  "grid-oib:pgBackupSecretKey": "pg-secret", // pragma: allowlist secret
};

describe("the production app archive", () => {
  it("plans as today while the stack has no off-cluster bucket", async () => {
    expect(await planWith(PROD_TODAY)).toBeNull();
  });

  it("is refused on the in-cluster SeaweedFS once the stack archives anything off-cluster", async () => {
    const error = await planWith({ ...PROD_TODAY, ...BACKGROUND_WORK_OFFSITE });
    expect(error?.message).toMatch(/production app database archive.*in-cluster SeaweedFS/);
    expect(error?.message).toContain("backgroundWorkPgBackupEndpoint=https://s3.offsite.example.test");
  });

  it("counts SeaweedFS's own public route as in-cluster", async () => {
    const error = await planWith({
      ...PROD_TODAY,
      ...BACKGROUND_WORK_OFFSITE,
      ...APP_OFFSITE,
      "grid-oib:pgBackupEndpoint": "https://s3.example.test",
    });
    expect(error?.message).toMatch(/production app database archive/);
  });

  it("plans once the app archive has its own external bucket and credentials", async () => {
    expect(await planWith({ ...PROD_TODAY, ...BACKGROUND_WORK_OFFSITE, ...APP_OFFSITE })).toBeNull();
  });

  it("refuses an external endpoint without its own credentials, which would sign with SeaweedFS's", async () => {
    const { "grid-oib:pgBackupSecretKey": _dropped, ...withoutSecret } = APP_OFFSITE;
    const error = await planWith({ ...PROD_TODAY, ...withoutSecret });
    expect(error?.message).toMatch(/pgBackupEndpoint points outside the cluster.*pgBackupAccessKey/);
  });
});
