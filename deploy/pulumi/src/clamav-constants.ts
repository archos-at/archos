/** The malware scanner's fixed names, ports, paths and sizes, kept out of `constants.ts`. */

/**
 * ClamAV (ADR-0157): clamd, the malware scanner behind `MALWARE_SCAN_URL`,
 * with freshclam beside it. Off by default (`malwareScanEnabled`).
 *
 * The image is a knob (`malwareScanImage`, digest-pinned); the name, the port,
 * the paths and the signature age are fixed, because the frontend's URL, the
 * NetworkPolicy, the Compose service and the BFF's own freshness rule
 * (`apps/workspace/bff/malware-scan/config.ts`) all have to agree with them.
 */
export const CLAMAV = {
  /** Deployment/Service name and `app.kubernetes.io/name`. */
  name: "clamav",
  /** clamd's port, the upstream default. */
  port: 3310,
  /**
   * The image's user `clamav` (100) and group `clamav` (101). Its entrypoint
   * starts as root to chown and drop privileges; the pod skips it and starts
   * clamd and freshclam as this user directly.
   */
  uid: 100,
  gid: 101,
  /**
   * The age past which the loaded signature database is refused: the BFF fails
   * every scan with `stale-signatures`, and the readiness probe fails, so the
   * pod is taken out of the Service and shows as not ready. Equal to the BFF's
   * `MAX_SIGNATURE_AGE_MS` (asserted in `clamav.spec.ts`).
   */
  maxSignatureAgeHours: 48,
  /**
   * Where clamd.conf and freshclam.conf are mounted, the image's own path.
   * Both files live in `deploy/compose/clamav/`, one source for both deploy paths.
   */
  configPath: "/etc/clamav",
  /** The signature database: an emptyDir both containers share, seeded from the image. */
  databasePath: "/var/lib/clamav",
  /**
   * clamd holds the whole database in memory, and while it loads a new one
   * (`ConcurrentDatabaseReload yes`) it holds two: about 1 GiB each for 1.5.
   * The request is what it needs steadily, the limit what a reload needs.
   */
  resources: {
    requests: { cpu: "250m", memory: "2Gi" },
    limits: { cpu: "2", memory: "4Gi" },
  },
  /**
   * freshclam: a download and a signature check every two hours. The check
   * (`TestDatabases`, on by default) loads the whole database the way clamd
   * does, so its peak is clamd's, not a downloader's: at 512Mi the first start
   * on dev was OOMKilled 22 s in, every restart, on ClamAV 1.5.4 (2026-11-05).
   * The request stays small, since it idles between checks; the limit leaves
   * the load room.
   */
  freshclamResources: {
    requests: { cpu: "10m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "2Gi" },
  },
  /** The init container that seeds the database from the image: one `cp`. */
  seedResources: {
    requests: { cpu: "10m", memory: "32Mi" },
    limits: { cpu: "500m", memory: "128Mi" },
  },
} as const;
