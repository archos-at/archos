const MiB = 1024 * 1024;

export const LIMITS = Object.freeze({
  sessions: 2,
  pagesPerSession: 10,
  sessionMs: 190_000,
  connectWithinMs: 10_000,
  outputBytes: 50 * MiB,
  messageBytes: 72 * MiB,
});

export const ASSET_HOST = "assets.local";
