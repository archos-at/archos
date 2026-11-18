# The code runner: `apps/code-runner`

Runs one agent-written module in a fresh workerd isolate and returns its result and files. Contract,
limits, measurements and the reasons behind each rule: [`README.md`](README.md).

- No network in a run, ever: `globalOutbound: null` in `src/runner.js`, and `globalOutbound =
  "no-network"` in `config.capnp`. The isolation suite's `fetch` case must stay green.
- A fresh Durable Object per run (`newUniqueId()`), never a named or reused one. Nothing of one run
  may be visible to the next; `a run sees nothing of the run before it` holds that.
- Delete a run's storage before its response leaves (`ctx.storage.deleteAll()` in a `finally`), and
  keep `bin/sweep.mjs` removing the emptied files. The storage test checks no byte of a run is left.
- One run per workerd process (a slot), held by the watchdog in `bin/server.mjs`: self-hosted
  workerd enforces no CPU limit, and a synchronous loop stops its whole process.
- A run imports only what `libraries.json` admits, each library with a case in
  `test/libraries.test.mjs` that uses it inside the isolate. Pin exact versions and commit `bun.lock`.
- The HTTP contract in `README.md` is what other services are built against; change it only with them.
- Run `task runner:test` before you push a change here, and `task runner:e2e` for the agent's side.
