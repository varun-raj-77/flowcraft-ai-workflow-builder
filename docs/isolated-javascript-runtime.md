# Milestone 4B — WebAssembly-isolated Transform and Condition execution

This milestone replaces direct `new Function()` evaluation inside the API server with a dedicated **QuickJS JavaScript interpreter compiled to WebAssembly**, running on a separate, disposable Node Worker thread. Guest scripts see the existing `input`, `prev` and `nodes` contract but **not the host process, filesystem, Node modules, network APIs or runtime secrets**. There are no host callbacks or module loaders registered in the guest.

## Security layers

- Each script gets a fresh QuickJS runtime/context; scripts do not share globals.
- QuickJS runtime has a 16 MiB guest allocation limit, 256 KiB guest stack limit, and a ~400 ms execution-interrupt deadline.
- A Worker watchdog kills the Worker after 2.5 seconds of total wall-clock time, including initialization. The Worker has its own Node heap limits (64 MiB old generation, 16 MiB young) and receives no environment variables.
- No more than four simultaneous Worker executions are allowed per backend process. Excess load fails closed with a retryable error.
- Input JSON is limited to 256 KiB, script source to 16 KiB and serialized output to 256 KiB.
- Returned data is JSON-compatible; arbitrary JS functions, cyclic results, non-JSON special values and async Promises are not part of the supported user-code contract.
- Transform failures continue through structured transform diagnostics; **ordinary guest expression errors** may retain the legacy false-branch behavior with a redacted error. **Sandbox timeouts, resource limits, crashes and initialization failures stop the workflow** rather than silently choosing the false branch. Condition logs no expression source.

## Compatibility and intentional restrictions

Common synchronous JavaScript operations (arrays, filter/map, object literals, predicates, template-expanded conditions, JSON-compatible values) are supported. Because QuickJS is a different JS engine, unsupported Node/browser globals (e.g. `process`, `require`, `fetch`, `setTimeout` and `console`) are unavailable. Async operations and host-side network/filesystem access within user Transform/Condition code are intentionally unsupported. Use a dedicated API Call node for HTTP access (it has its own network restrictions).

Saved graph definitions and revisions are never rewritten. Workflows whose user-authored JavaScript depends on blocked globals or exceeds resource limits may fail at execution; this is a deliberate security change. A separate compatibility review with representative saved workflows is recommended before enabling all production users.

## Remaining security work

Worker threads by themselves are **not** a strong operating-system security boundary. Here, untrusted code is interpreted **inside QuickJS WASM**, with no host bridges and a worker kill switch, rather than evaluated by Node/V8. As with any interpreter, vulnerabilities in QuickJS, WASM and host bindings are possible. For multi-tenant commercial workloads with hostile users, evaluate **separate OS-locked-down containers/microVMs with network and filesystem deny-by-default, tenant quotas, monitoring and sandbox version upgrades**.

This PR does not change API Call SSRF protections, implement durable queues, add CI to test sandbox resource usage under load, or claim a full penetration test.

## Validation

- Unit tests run real isolated JS and verify standard FlowCraft contracts, unavailable host globals, Function constructor isolation, infinite loops, oversized inputs/outputs and diagnostics.
- GitHub CI typechecks, lints, builds and executes regression tests plus Playwright browser flows.
- The local/CI tests are not a substitute for production load testing and security review.

**No merge or production deployment without the owner's explicit approval.**
