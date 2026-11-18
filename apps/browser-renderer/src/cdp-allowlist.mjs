export const ALLOWED = new Map([
  [
    "Page",
    [
      "enable",
      "getFrameTree",
      "setLifecycleEventsEnabled",
      "addScriptToEvaluateOnNewDocument",
      "createIsolatedWorld",
      "navigate",
      "setDocumentContent",
      "printToPDF",
      "captureScreenshot",
    ],
  ],
  ["Runtime", ["enable", "evaluate", "callFunctionOn", "getProperties", "releaseObject", "runIfWaitingForDebugger", "addBinding"]],
  ["DOM", ["describeNode", "resolveNode"]],
  ["Emulation", ["setDeviceMetricsOverride", "setEmulatedMedia", "setTouchEmulationEnabled", "setDefaultBackgroundColorOverride"]],
  ["Input", ["dispatchKeyEvent", "dispatchMouseEvent", "dispatchTouchEvent", "insertText"]],
  ["Network", ["enable"]],
  ["Log", ["enable"]],
  ["Performance", ["enable"]],
  ["Audits", ["enable"]],
  [
    "Target",
    ["getBrowserContexts", "setDiscoverTargets", "setAutoAttach", "createTarget", "closeTarget", "attachToTarget", "detachFromTarget", "getTargets"],
  ],
  ["Browser", ["getVersion", "close"]],
  ["IO", ["read", "close"]],
]);

const METHODS = new Set([...ALLOWED].flatMap(([domain, names]) => names.map((name) => `${domain}.${name}`)));

export function allowed(method) {
  return METHODS.has(method);
}

export function allowedMethods() {
  return [...METHODS].sort();
}
