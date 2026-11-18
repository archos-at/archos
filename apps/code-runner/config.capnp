using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .runner),
    (name = "run-storage", disk = (path = "/run/code-runner/do", writable = true)),
    (name = "no-network", network = (allow = [])),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:8081", http = (), service = "main") ],
);

const runner :Workerd.Worker = (
  modules = [ (name = "worker.js", esModule = embed "dist/worker.js") ],
  compatibilityDate = "2026-05-26",
  compatibilityFlags = ["nodejs_compat"],
  bindings = [
    (name = "LOADER", workerLoader = ()),
    (name = "RUNNER", durableObjectNamespace = "Runner"),
  ],
  durableObjectNamespaces = [ (className = "Runner", uniqueKey = "code-runner", enableSql = true) ],
  durableObjectStorage = (localDisk = "run-storage"),
  globalOutbound = "no-network",
);
