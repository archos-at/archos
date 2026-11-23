using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .runner),
    (name = "run-storage", disk = (path = "/run/code-runner/do", writable = true)),
    (name = "no-network", network = (allow = [])),
    (name = "browser-renderer", external = (address = "127.0.0.1:9", http = ())),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:8081", http = (), service = "main") ],
);

const runner :Workerd.Worker = (
  modules = [
    (name = "worker.js", esModule = embed "dist/worker.js"),
    (name = "typst-compiler.wasm", data = embed "dist/typst-compiler.wasm"),
    (name = "typst-files.bin", data = embed "dist/typst-files.bin"),
    (name = "forme.wasm", data = embed "dist/forme.wasm"),
  ],
  compatibilityDate = "2026-05-26",
  compatibilityFlags = ["nodejs_compat"],
  bindings = [
    (name = "LOADER", workerLoader = ()),
    (name = "RUNNER", durableObjectNamespace = "Runner"),
    (name = "BROWSER_RENDERER", service = "browser-renderer"),
    (name = "BROWSER_RENDERER_ADDR", fromEnvironment = "BROWSER_RENDERER_ADDR"),
  ],
  durableObjectNamespaces = [ (className = "Runner", uniqueKey = "code-runner", enableSql = true) ],
  durableObjectStorage = (localDisk = "run-storage"),
  globalOutbound = "no-network",
);
