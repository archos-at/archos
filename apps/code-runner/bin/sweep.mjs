import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const RUN_FILE = /^[0-9a-f]{64}\.sqlite(-wal|-shm|-journal)?$/;

export const SWEEP_AFTER_MS = 5 * 60_000;

export async function sweep(dir, olderThanMs = SWEEP_AFTER_MS, now = Date.now()) {
  let removed = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += await sweep(path, olderThanMs, now);
      continue;
    }
    if (!RUN_FILE.test(entry.name)) continue;
    const info = await stat(path).catch(() => null);
    if (info === null || now - info.mtimeMs < olderThanMs) continue;
    await rm(path, { force: true });
    removed += 1;
  }
  return removed;
}
