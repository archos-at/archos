const ALL = "*";

export const ALLOWED = new Map([
  ["Page", ALL],
  ["Runtime", ALL],
  ["DOM", ALL],
  ["CSS", ALL],
  ["Emulation", ALL],
  ["Input", ALL],
  ["Log", ALL],
  ["Performance", ALL],
  ["Accessibility", ALL],
  ["Animation", ALL],
  ["Audits", new Set(["enable", "disable"])],
  ["Inspector", new Set(["enable", "disable"])],
  ["Security", new Set(["enable", "disable", "setIgnoreCertificateErrors"])],
  ["Debugger", new Set(["enable", "disable", "getScriptSource", "setSkipAllPauses"])],
  ["Profiler", new Set(["enable", "disable", "startPreciseCoverage", "stopPreciseCoverage", "takePreciseCoverage"])],
  [
    "Network",
    new Set([
      "enable",
      "disable",
      "setCacheDisabled",
      "setExtraHTTPHeaders",
      "setUserAgentOverride",
      "setBypassServiceWorker",
      "emulateNetworkConditions",
      "emulateNetworkConditionsByRule",
      "getResponseBody",
      "getRequestPostData",
      "getCookies",
      "setCookies",
      "deleteCookies",
    ]),
  ],
  [
    "Target",
    new Set([
      "setDiscoverTargets",
      "setAutoAttach",
      "autoAttachRelated",
      "getBrowserContexts",
      "createBrowserContext",
      "disposeBrowserContext",
      "createTarget",
      "closeTarget",
      "attachToTarget",
      "detachFromTarget",
      "activateTarget",
      "getTargetInfo",
      "getTargets",
    ]),
  ],
  ["Browser", new Set(["getVersion", "close"])],
  ["IO", new Set(["read", "close"])],
]);

export const REFUSED_PAGE_METHODS = new Set(["setDownloadBehavior", "startScreencast", "startScreenRecording", "setInterceptFileChooserDialog"]);
export const REFUSED_DOM_METHODS = new Set(["setFileInputFiles"]);

export function allowed(method) {
  const dot = method.indexOf(".");
  if (dot <= 0) return false;
  const domain = method.slice(0, dot);
  const name = method.slice(dot + 1);
  if (domain === "Page" && REFUSED_PAGE_METHODS.has(name)) return false;
  if (domain === "DOM" && REFUSED_DOM_METHODS.has(name)) return false;
  const methods = ALLOWED.get(domain);
  return methods === ALL || (methods instanceof Set && methods.has(name));
}
