import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

export function chromeArgs({ profile, proxyPort }) {
  return [
    "--headless",
    "--no-sandbox",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--metrics-recording-only",
    "--no-pings",
    "--mute-audio",
    "--hide-scrollbars",
    "--font-render-hinting=none",
    "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,InterestFeedContentSuggestions",
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    "--disable-file-system",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    "about:blank",
  ];
}

export class Session {
  #child = null;
  #buffered = [];
  #closed = null;
  onmessage = () => {};
  onexit = () => {};
  stderr = "";

  constructor({ id, chrome, proxyPort, fontConfig, workRoot }) {
    this.id = id;
    this.chrome = chrome;
    this.proxyPort = proxyPort;
    this.fontConfig = fontConfig;
    this.workRoot = workRoot;
    this.started = Date.now();
  }

  get pid() {
    return this.#child?.pid;
  }

  async start() {
    this.profile = await mkdtemp(join(this.workRoot, "profile-"));
    const child = spawn(this.chrome, chromeArgs({ profile: this.profile, proxyPort: this.proxyPort }), {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      env: { HOME: this.profile, FONTCONFIG_FILE: this.fontConfig, ...(process.env.TZ ? { TZ: process.env.TZ } : {}) },
      detached: true,
    });
    this.#child = child;
    this.groupId = child.pid;
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4096);
    });
    child.stdio[4].on("data", (chunk) => this.#receive(chunk));
    child.stdio[3].on("error", () => undefined);
    child.on("close", () => {
      this.#child = null;
      this.onexit();
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  }

  #receive(chunk) {
    let start = 0;
    for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, start)) {
      this.#buffered.push(chunk.subarray(start, end));
      const message = Buffer.concat(this.#buffered).toString("utf8");
      this.#buffered = [];
      this.onmessage(message);
      start = end + 1;
    }
    if (start < chunk.length) this.#buffered.push(chunk.subarray(start));
  }

  send(text) {
    this.#child?.stdio[3].write(`${text}\0`);
  }

  close() {
    this.#closed ??= this.#close();
    return this.#closed;
  }

  async #close() {
    const child = this.#child;
    if (this.groupId) {
      try {
        process.kill(-this.groupId, "SIGKILL");
      } catch {
        child?.kill("SIGKILL");
      }
    }
    if (child && child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
    if (this.profile) await rm(this.profile, { recursive: true, force: true });
  }
}
