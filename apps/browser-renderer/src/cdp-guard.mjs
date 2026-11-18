import { allowed } from "./cdp-allowlist.mjs";
import { ASSET_HOST } from "./limits.mjs";

const NO_NETWORK =
  "A page here loads nothing from the network. Put the HTML in with page.setContent(html); " +
  "for a file under /workspace/, read it with node:fs and pass its text to page.setContent, " +
  "and embed images as data: URLs.";

const REASONS = new Map([
  ["Browser.setDownloadBehavior", "Downloads are off: page.pdf() and page.screenshot() return the bytes; write them under /workspace/."],
  ["Page.setDownloadBehavior", "Downloads are off: page.pdf() and page.screenshot() return the bytes; write them under /workspace/."],
  ["Fetch", "Request interception is fixed here: every request except data: and blob: URLs is refused."],
  ["DOM.setFileInputFiles", "File uploads are off: the browser has no files."],
  ["Input.dispatchDragEvent", "Drag and drop is off: it can carry files into the page."],
  ["Input.setInterceptDrags", "Drag and drop is off: it can carry files into the page."],
  ["IO", "Only the stream of a PDF this run printed can be read."],
]);

const FILE_URL = /(^|[^a-z0-9+.-])file:/i;
const GUARD_IDS = 1_000_000_000;

function reasonFor(method) {
  return REASONS.get(method) ?? REASONS.get(method.slice(0, method.indexOf("."))) ?? "This DevTools method is not on the renderer's allowlist.";
}

export function navigable(url) {
  return typeof url === "string" && (url === "about:blank" || url.startsWith("data:"));
}

export function namesFileUrl(value) {
  if (typeof value === "string") return FILE_URL.test(value);
  if (Array.isArray(value)) return value.some(namesFileUrl);
  if (value !== null && typeof value === "object") return Object.entries(value).some(([key, item]) => namesFileUrl(key) || namesFileUrl(item));
  return false;
}

function assetPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && parsed.host === ASSET_HOST ? parsed.pathname : null;
  } catch {
    return null;
  }
}

export class Guard {
  #pdfCalls = new Set();
  #streams = new Set();
  #own = new Map();
  #nextId = GUARD_IDS;
  #pages = 0;
  #clientBytes = 0;
  #browserSession = null;
  refused = [];

  constructor(limits, { toBrowser, assets = new Map(), onOverflow = () => {} }) {
    this.limits = limits;
    this.toBrowser = toBrowser;
    this.assets = assets;
    this.onOverflow = onOverflow;
    this.toClient = () => {};
  }

  get clientBytes() {
    return this.#clientBytes;
  }

  #call(method, params = {}, sessionId) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#own.set(id, { resolve, reject, method });
      this.toBrowser(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async setup() {
    const attached = await this.#call("Target.attachToBrowserTarget");
    this.#browserSession = attached.sessionId;
    await this.#call("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, this.#browserSession);
    await this.#call("Browser.setDownloadBehavior", { behavior: "deny" }, this.#browserSession);
    await this.#call("Target.setDiscoverTargets", { discover: true }, this.#browserSession);
  }

  refusal(message, error) {
    return JSON.stringify({
      id: message.id,
      ...(message.sessionId ? { sessionId: message.sessionId } : {}),
      error: { code: -32000, message: error },
    });
  }

  command(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return { close: "The message is not JSON." };
    }
    if (!Number.isInteger(message?.id) || message.id < 0 || message.id >= GUARD_IDS || typeof message.method !== "string") {
      return { close: "The message is not a DevTools command." };
    }
    const { method } = message;
    const params = message.params ?? {};
    if (message.sessionId !== undefined && message.sessionId === this.#browserSession) return { close: "That session is not yours." };
    if (params.sessionId !== undefined && params.sessionId === this.#browserSession) {
      return { reply: this.refusal(message, "That session is not available here.") };
    }
    if (!allowed(method)) return { reply: this.refusal(message, `${method} is refused. ${reasonFor(method)}`) };
    if (method === "Page.navigate" && !navigable(params.url)) {
      return { reply: this.refusal(message, `page.goto(${JSON.stringify(String(params.url).slice(0, 200))}) is refused. ${NO_NETWORK}`) };
    }
    if (namesFileUrl(params)) {
      return { reply: this.refusal(message, `${method} is refused: nothing here may name a file: URL. ${NO_NETWORK}`) };
    }
    if (method === "Browser.close") {
      return { reply: JSON.stringify({ id: message.id, result: {} }), close: "the client closed the browser" };
    }
    if (method.startsWith("IO.") && !this.#streams.has(params.handle)) {
      return { reply: this.refusal(message, `${method} is refused. ${reasonFor(method)}`) };
    }
    if (method === "IO.close") this.#streams.delete(params.handle);
    if (method === "Target.createTarget") {
      if (params.url !== undefined && params.url !== "" && params.url !== "about:blank") {
        return { reply: this.refusal(message, `A new page opens only about:blank; put content in with page.setContent(html). ${NO_NETWORK}`) };
      }
      if (this.#pages >= this.limits.pagesPerSession) {
        return { reply: this.refusal(message, `A run may open at most ${this.limits.pagesPerSession} pages. Reuse a page, or close one with page.close().`) };
      }
      this.#pages += 1;
    }
    if (method === "Page.printToPDF") this.#pdfCalls.add(`${message.sessionId ?? ""}:${message.id}`);
    return { forward: JSON.stringify(message) };
  }

  fromBrowser(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (Number.isInteger(message.id) && message.id >= GUARD_IDS) {
      const own = this.#own.get(message.id);
      this.#own.delete(message.id);
      if (message.error) own?.reject(new Error(`${own.method}: ${message.error.message}`));
      else own?.resolve(message.result ?? {});
      return;
    }
    if (this.#browserSession && message.sessionId === this.#browserSession) return this.#guardEvent(message);
    if (message.id !== undefined) {
      const key = `${message.sessionId ?? ""}:${message.id}`;
      if (this.#pdfCalls.delete(key) && typeof message.result?.stream === "string") this.#streams.add(message.result.stream);
    }
    this.#clientBytes += Buffer.byteLength(text);
    if (this.#clientBytes > this.limits.outputBytes) {
      this.onOverflow(`the run received more than ${this.limits.outputBytes} bytes from the browser`);
      return;
    }
    this.toClient(text);
  }

  #guardEvent(message) {
    if (message.method === "Fetch.requestPaused") return this.#paused(message.params);
    if (message.method === "Target.targetCreated") {
      const info = message.params.targetInfo;
      if (info.type === "page" && info.openerId) {
        this.refused.push(`window.open ${info.url}`);
        this.#call("Target.closeTarget", { targetId: info.targetId }).catch(() => undefined);
      }
    }
  }

  #paused({ requestId, request }) {
    const path = assetPath(request.url);
    const asset = path === null ? undefined : this.assets.get(path);
    if (asset && request.method === "GET") {
      this.#call(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: asset.type },
            { name: "Access-Control-Allow-Origin", value: "*" },
          ],
          body: asset.base64,
        },
        this.#browserSession,
      ).catch(() => undefined);
      return;
    }
    this.refused.push(request.url.slice(0, 200));
    this.#call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, this.#browserSession).catch(() => undefined);
  }
}
