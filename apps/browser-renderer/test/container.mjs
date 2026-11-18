import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const IMAGE = process.env.BROWSER_RENDERER_IMAGE ?? "browser-renderer:test";
const NETWORK = "browser-renderer-test";

export const HARDENING = [
  "--read-only",
  "--tmpfs",
  "/tmp:size=512m",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--security-opt",
  "seccomp=unconfined",
  "--user",
  "10042:10042",
  "--memory",
  "3g",
  "--cpus",
  "2",
  "--pids-limit",
  "512",
];

async function docker(...args) {
  const { stdout } = await exec("docker", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export async function startContainer({ sessions = 2 } = {}) {
  await docker("network", "inspect", NETWORK).catch(() => docker("network", "create", "--internal", NETWORK));
  const id = await docker("run", "-d", "--rm", "--network", NETWORK, ...HARDENING, "-e", `BROWSER_RENDERER_SESSIONS=${sessions}`, IMAGE);
  const ip = await docker("inspect", id, "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}");
  const url = `http://${ip}:9222`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const ok = await fetch(`${url}/health`).then((response) => response.ok, () => false);
    if (ok) break;
    if (Date.now() > deadline) {
      const logs = await docker("logs", id).catch(() => "");
      await docker("rm", "-f", id).catch(() => "");
      throw new Error(`the browser renderer did not become ready: ${logs.slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    id,
    addr: `${ip}:9222`,
    url,
    shell: (script) => docker("exec", id, "sh", "-c", script),
    logs: async () =>
      (await docker("logs", id))
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    stop: () => docker("rm", "-f", id).catch(() => ""),
  };
}
