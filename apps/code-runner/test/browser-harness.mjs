import { startContainer } from "../../browser-renderer/test/container.mjs";

export async function startBrowserRenderer({ sessions = 2 } = {}) {
  const container = await startContainer({ sessions });
  return {
    addr: container.addr,
    logs: container.logs,
    stop: container.stop,
  };
}
