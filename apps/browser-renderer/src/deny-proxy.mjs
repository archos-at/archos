import { createServer } from "node:http";

export async function startDenyProxy() {
  let refused = 0;
  const server = createServer((_req, res) => {
    refused += 1;
    res.writeHead(403, { "content-type": "text/plain", connection: "close" });
    res.end("Refused: the browser renderer has no network.\n");
  });
  const refuseSocket = (_req, socket) => {
    refused += 1;
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  };
  server.on("connect", refuseSocket);
  server.on("upgrade", refuseSocket);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    get refused() {
      return refused;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
