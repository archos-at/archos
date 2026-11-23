const MiB = 1024 * 1024;

export const LIMITS = Object.freeze({
  maxSourceBytes: 1 * MiB,
  maxInputBytes: 50 * MiB,
  maxOutputBytes: 50 * MiB,
  maxValueBytes: 8 * MiB,
  maxStdioBytes: 64 * 1024,
  defaultTimeoutMs: 60_000,
  maxTimeoutMs: 180_000,
  maxEntries: 10_000,
});

export const WORKSPACE_ROOT = "/workspace";
