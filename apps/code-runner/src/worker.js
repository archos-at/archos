export { Runner } from "./runner.js";

function json(status, body) {
  return Response.json(body, { status });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      return request.method === "GET" ? new Response("ok") : json(405, { error: "Use GET." });
    }
    if (pathname !== "/run") return json(404, { error: "Not found. POST /run or GET /health." });
    if (request.method !== "POST") return json(405, { error: "Use POST." });
    return env.RUNNER.get(env.RUNNER.newUniqueId()).fetch(request);
  },
};
