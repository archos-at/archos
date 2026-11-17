export const CLAMAV = {
  name: "clamav",
  port: 3310,
  uid: 100,
  gid: 101,
  maxSignatureAgeHours: 48,
  configPath: "/etc/clamav",
  databasePath: "/var/lib/clamav",
  resources: {
    requests: { cpu: "250m", memory: "2Gi" },
    limits: { cpu: "2", memory: "4Gi" },
  },
  freshclamResources: {
    requests: { cpu: "10m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "2Gi" },
  },
  seedResources: {
    requests: { cpu: "10m", memory: "32Mi" },
    limits: { cpu: "500m", memory: "128Mi" },
  },
} as const;
